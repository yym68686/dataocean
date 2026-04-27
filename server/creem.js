import { createHmac, timingSafeEqual } from "node:crypto";
import { pool } from "./database.js";

const LIVE_BASE_URL = "https://api.creem.io";
const TEST_BASE_URL = "https://test-api.creem.io";
const DEFAULT_SYNC_INTERVAL_MS = 60 * 60 * 1000;
const DEFAULT_SYNC_MAX_PAGES = 4;
const DEFAULT_SYNC_PAGE_SIZE = 50;
const DEFAULT_CURRENCY = "USD";

const schedulerState = {
  enabled: false,
  intervalMs: 0,
  maxPages: DEFAULT_SYNC_MAX_PAGES,
  pageSize: DEFAULT_SYNC_PAGE_SIZE,
  running: false,
  lastStartedAt: null,
  lastFinishedAt: null,
  lastSuccessAt: null,
  lastErrorAt: null,
  lastError: null,
  lastResult: null,
  nextRunAt: null,
  timer: null,
  initialTimer: null,
};

export function getCreemConfig() {
  const apiKey = process.env.CREEM_API_KEY?.trim();
  const webhookSecret = process.env.CREEM_WEBHOOK_SECRET?.trim();
  const inferredBaseUrl = apiKey?.startsWith("creem_test_") ? TEST_BASE_URL : LIVE_BASE_URL;
  const baseUrl = (process.env.CREEM_BASE_URL || inferredBaseUrl).replace(/\/+$/, "");
  const currency = (process.env.CREEM_CURRENCY || DEFAULT_CURRENCY).trim().toUpperCase();

  return {
    apiKey,
    webhookSecret,
    baseUrl,
    currency,
    mode: baseUrl.includes("test-api") || apiKey?.startsWith("creem_test_") ? "test" : "live",
    configured: Boolean(apiKey),
    webhookConfigured: Boolean(webhookSecret),
  };
}

export async function getCreemStatus() {
  const config = getCreemConfig();
  const [snapshotResult, transactionResult, customerResult, subscriptionResult] = await Promise.all([
    pool.query("select captured_at, raw from creem_store_snapshots order by captured_at desc limit 1"),
    pool.query("select count(*)::int as count, max(updated_at) as last_transaction_at from creem_transactions"),
    pool.query("select count(*)::int as count from creem_customers"),
    pool.query("select count(*)::int as count from creem_subscriptions"),
  ]);

  return {
    configured: config.configured,
    webhookConfigured: config.webhookConfigured,
    apiKeyConfigured: Boolean(config.apiKey),
    baseUrl: config.baseUrl,
    mode: config.mode,
    currency: config.currency,
    lastSnapshotAt: snapshotResult.rows[0]?.captured_at ?? null,
    lastSnapshot: snapshotResult.rows[0]?.raw ?? null,
    transactionCount: Number(transactionResult.rows[0]?.count ?? 0),
    lastTransactionAt: transactionResult.rows[0]?.last_transaction_at ?? null,
    customerCount: Number(customerResult.rows[0]?.count ?? 0),
    subscriptionCount: Number(subscriptionResult.rows[0]?.count ?? 0),
    scheduler: getCreemSchedulerStatus(),
  };
}

export function startCreemScheduler() {
  if (schedulerState.timer || schedulerState.initialTimer) {
    return getCreemSchedulerStatus();
  }

  const enabled = readBooleanEnv("CREEM_SYNC_ENABLED", false);
  const intervalMs = readIntegerEnv("CREEM_SYNC_INTERVAL_MS", DEFAULT_SYNC_INTERVAL_MS);

  schedulerState.enabled = enabled && intervalMs > 0;
  schedulerState.intervalMs = intervalMs;
  schedulerState.maxPages = readIntegerEnv("CREEM_SYNC_MAX_PAGES", DEFAULT_SYNC_MAX_PAGES);
  schedulerState.pageSize = readIntegerEnv("CREEM_SYNC_PAGE_SIZE", DEFAULT_SYNC_PAGE_SIZE);

  if (!schedulerState.enabled) {
    return getCreemSchedulerStatus();
  }

  const run = () => {
    runScheduledCreemSync().catch((error) => {
      schedulerState.lastErrorAt = new Date().toISOString();
      schedulerState.lastError = error.message ?? "Scheduled Creem sync failed";
      console.warn("[creem] scheduled sync failed", schedulerState.lastError);
    });
  };

  const initialDelayMs = readIntegerEnv("CREEM_SYNC_INITIAL_DELAY_MS", 10_000);
  schedulerState.nextRunAt = new Date(Date.now() + Math.max(initialDelayMs, 0)).toISOString();
  schedulerState.initialTimer = setTimeout(() => {
    schedulerState.initialTimer = null;
    run();
  }, Math.max(initialDelayMs, 0));
  schedulerState.initialTimer.unref?.();

  schedulerState.timer = setInterval(run, schedulerState.intervalMs);
  schedulerState.timer.unref?.();

  console.log(
    `[creem] scheduled sync enabled interval=${schedulerState.intervalMs}ms maxPages=${schedulerState.maxPages} pageSize=${schedulerState.pageSize}`,
  );

  return getCreemSchedulerStatus();
}

export function getCreemSchedulerStatus() {
  return {
    enabled: schedulerState.enabled,
    intervalMs: schedulerState.intervalMs,
    maxPages: schedulerState.maxPages,
    pageSize: schedulerState.pageSize,
    running: schedulerState.running,
    lastStartedAt: schedulerState.lastStartedAt,
    lastFinishedAt: schedulerState.lastFinishedAt,
    lastSuccessAt: schedulerState.lastSuccessAt,
    lastErrorAt: schedulerState.lastErrorAt,
    lastError: schedulerState.lastError,
    lastResult: schedulerState.lastResult,
    nextRunAt: schedulerState.nextRunAt,
  };
}

export async function syncCreem({ maxPages = DEFAULT_SYNC_MAX_PAGES, pageSize = DEFAULT_SYNC_PAGE_SIZE } = {}) {
  assertConfigured();

  const pageCount = Math.min(Math.max(Number(maxPages) || DEFAULT_SYNC_MAX_PAGES, 1), 20);
  const limit = Math.min(Math.max(Number(pageSize) || DEFAULT_SYNC_PAGE_SIZE, 1), 100);
  const transactions = await syncPagedCreem("/v1/transactions/search", pageCount, limit, (item) =>
    upsertCreemTransaction(item, "sync"),
  );
  const customers = await syncPagedCreem("/v1/customers/list", pageCount, limit, (item) => upsertCreemCustomer(item, "sync"));
  const subscriptions = await syncPagedCreem("/v1/subscriptions/search", pageCount, limit, (item) =>
    upsertCreemSubscription(item, "sync"),
  );
  const snapshot = await insertCreemSnapshot({
    transactions,
    customers,
    subscriptions,
    maxPages: pageCount,
    pageSize: limit,
  });

  return {
    ok: true,
    syncedTransactions: transactions,
    syncedCustomers: customers,
    syncedSubscriptions: subscriptions,
    snapshot,
  };
}

export async function handleCreemWebhook({ rawBody, signature, body }) {
  const config = assertWebhookConfigured();
  const payloadText = rawBody || JSON.stringify(body ?? {});

  if (!verifyCreemSignature(payloadText, signature, config.webhookSecret)) {
    const error = new Error("Invalid Creem webhook signature");
    error.status = 401;
    throw error;
  }

  const event = body ?? JSON.parse(payloadText);
  if (!event?.id || !event?.eventType) {
    const error = new Error("Invalid Creem webhook event");
    error.status = 400;
    throw error;
  }

  await pool.query(
    `
      insert into creem_webhook_events (id, event_type, source_created_at, raw)
      values ($1, $2, $3, $4::jsonb)
      on conflict (id) do nothing
    `,
    [String(event.id), String(event.eventType), parseCreemTime(event.created_at), JSON.stringify(event)],
  );

  await applyCreemEvent(event);
  const snapshot = await insertCreemSnapshot({ webhookEventId: event.id, eventType: event.eventType });

  return { ok: true, eventId: event.id, eventType: event.eventType, snapshot };
}

export async function queryCreemMetric({ dataSource, metric, query }) {
  if (metric.key === "creem_recent_transactions") {
    return createCreemRecentTransactionsResult({ dataSource, metric });
  }

  if (metric.key === "creem_revenue_trend") {
    return createCreemRevenueTrendResult({ dataSource, metric, timeRange: query.timeRange });
  }

  return createCreemSnapshotKpiResult({ dataSource, metric });
}

export async function listCreemTransactions({ limit = 50 } = {}) {
  const result = await pool.query(
    `
      select id, type, status, amount, amount_paid, refunded_amount, currency, order_id, subscription_id,
             customer_id, description, source_created_at, source, updated_at
      from creem_transactions
      order by coalesce(source_created_at, updated_at) desc
      limit $1
    `,
    [Math.min(Math.max(Number(limit) || 50, 1), 200)],
  );
  return result.rows;
}

export async function getCreemSummary() {
  const snapshot = await getLatestCreemSnapshot();
  const statusCounts = await pool.query(
    `
      select status, count(*)::int as count
      from creem_subscriptions
      group by status
      order by status
    `,
  );

  return {
    snapshot,
    subscriptionStatuses: statusCounts.rows,
  };
}

async function syncPagedCreem(path, maxPages, pageSize, upsert) {
  let count = 0;

  for (let page = 1; page <= maxPages; page += 1) {
    const payload = await callCreem(path, {
      page_number: page,
      page_size: pageSize,
    });
    const items = extractItems(payload);

    for (const item of items) {
      await upsert(item);
    }

    count += items.length;

    const nextPage = payload?.pagination?.next_page ?? payload?.next_page;
    if (items.length < pageSize || nextPage === null) {
      break;
    }
  }

  return count;
}

async function callCreem(path, query = {}) {
  const config = assertConfigured();
  const url = new URL(`${config.baseUrl}${path}`);

  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  const response = await fetch(url, {
    headers: {
      "accept": "application/json",
      "x-api-key": config.apiKey,
    },
  });
  const text = await response.text();
  let json;

  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    const error = new Error(`Invalid Creem JSON response: ${text.slice(0, 160)}`);
    error.status = 502;
    throw error;
  }

  if (!response.ok) {
    const error = new Error(json.message || json.error || `Creem request failed with ${response.status}`);
    error.status = 502;
    error.payload = json;
    throw error;
  }

  return json;
}

async function applyCreemEvent(event) {
  const object = event.object ?? {};

  if (object.object === "customer" || object.email) {
    await upsertCreemCustomer(object, "webhook");
  }
  if (object.customer && typeof object.customer === "object") {
    await upsertCreemCustomer(object.customer, "webhook");
  }
  if (object.object === "subscription" || object.current_period_end_date) {
    await upsertCreemSubscription(object, "webhook");
  }
  if (object.subscription && typeof object.subscription === "object") {
    await upsertCreemSubscription(object.subscription, "webhook");
  }
  if (object.object === "transaction" || object.amount_paid !== undefined) {
    await upsertCreemTransaction(object, "webhook");
  }
  if (object.transaction) {
    await upsertCreemTransaction(
      typeof object.transaction === "object"
        ? {
            ...object.transaction,
            refunded_amount: object.refund_amount ?? object.transaction.refunded_amount,
            currency: object.refund_currency ?? object.transaction.currency,
          }
        : { id: object.transaction },
      "webhook",
    );
  }
  if (object.order) {
    await upsertCreemTransaction(createTransactionFromOrder(object.order), "webhook");
  }
}

async function upsertCreemTransaction(payload, source) {
  const id = stringValue(payload.id ?? payload.transaction_id ?? payload.transaction ?? payload.order_id ?? payload.order);
  if (!id) {
    return;
  }

  await pool.query(
    `
      insert into creem_transactions (
        id, mode, type, status, amount, amount_paid, refunded_amount, currency, tax_amount,
        discount_amount, order_id, subscription_id, customer_id, description, period_start,
        period_end, source_created_at, source, raw
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19::jsonb)
      on conflict (id) do update
        set mode = coalesce(excluded.mode, creem_transactions.mode),
            type = coalesce(excluded.type, creem_transactions.type),
            status = coalesce(excluded.status, creem_transactions.status),
            amount = coalesce(excluded.amount, creem_transactions.amount),
            amount_paid = coalesce(excluded.amount_paid, creem_transactions.amount_paid),
            refunded_amount = coalesce(excluded.refunded_amount, creem_transactions.refunded_amount),
            currency = coalesce(excluded.currency, creem_transactions.currency),
            tax_amount = coalesce(excluded.tax_amount, creem_transactions.tax_amount),
            discount_amount = coalesce(excluded.discount_amount, creem_transactions.discount_amount),
            order_id = coalesce(excluded.order_id, creem_transactions.order_id),
            subscription_id = coalesce(excluded.subscription_id, creem_transactions.subscription_id),
            customer_id = coalesce(excluded.customer_id, creem_transactions.customer_id),
            description = coalesce(excluded.description, creem_transactions.description),
            period_start = coalesce(excluded.period_start, creem_transactions.period_start),
            period_end = coalesce(excluded.period_end, creem_transactions.period_end),
            source_created_at = coalesce(excluded.source_created_at, creem_transactions.source_created_at),
            source = excluded.source,
            raw = excluded.raw,
            updated_at = now()
    `,
    [
      id,
      stringValue(payload.mode),
      stringValue(payload.type),
      stringValue(payload.status),
      nullableInt(payload.amount),
      nullableInt(payload.amount_paid ?? payload.amountPaid),
      nullableInt(payload.refunded_amount ?? payload.refund_amount),
      stringValue(payload.currency)?.toUpperCase(),
      nullableInt(payload.tax_amount),
      nullableInt(payload.discount_amount),
      entityId(payload.order ?? payload.order_id),
      entityId(payload.subscription ?? payload.subscription_id),
      entityId(payload.customer ?? payload.customer_id),
      stringValue(payload.description),
      parseCreemTime(payload.period_start),
      parseCreemTime(payload.period_end),
      parseCreemTime(payload.created_at),
      source,
      JSON.stringify(payload),
    ],
  );
}

async function upsertCreemCustomer(payload, source) {
  const id = stringValue(payload.id ?? payload.customer_id ?? payload.customer);
  if (!id) {
    return;
  }

  await pool.query(
    `
      insert into creem_customers (id, mode, email, name, country, source_created_at, source_updated_at, source, raw)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
      on conflict (id) do update
        set mode = coalesce(excluded.mode, creem_customers.mode),
            email = coalesce(excluded.email, creem_customers.email),
            name = coalesce(excluded.name, creem_customers.name),
            country = coalesce(excluded.country, creem_customers.country),
            source_created_at = coalesce(excluded.source_created_at, creem_customers.source_created_at),
            source_updated_at = coalesce(excluded.source_updated_at, creem_customers.source_updated_at),
            source = excluded.source,
            raw = excluded.raw,
            updated_at = now()
    `,
    [
      id,
      stringValue(payload.mode),
      stringValue(payload.email),
      stringValue(payload.name),
      stringValue(payload.country),
      parseCreemTime(payload.created_at),
      parseCreemTime(payload.updated_at),
      source,
      JSON.stringify(payload),
    ],
  );
}

async function upsertCreemSubscription(payload, source) {
  const id = stringValue(payload.id ?? payload.subscription_id ?? payload.subscription);
  if (!id) {
    return;
  }

  await pool.query(
    `
      insert into creem_subscriptions (
        id, mode, status, product_id, customer_id, last_transaction_id, last_transaction_date,
        next_transaction_date, current_period_start_date, current_period_end_date, canceled_at,
        source_created_at, source_updated_at, source, raw
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb)
      on conflict (id) do update
        set mode = coalesce(excluded.mode, creem_subscriptions.mode),
            status = coalesce(excluded.status, creem_subscriptions.status),
            product_id = coalesce(excluded.product_id, creem_subscriptions.product_id),
            customer_id = coalesce(excluded.customer_id, creem_subscriptions.customer_id),
            last_transaction_id = coalesce(excluded.last_transaction_id, creem_subscriptions.last_transaction_id),
            last_transaction_date = coalesce(excluded.last_transaction_date, creem_subscriptions.last_transaction_date),
            next_transaction_date = coalesce(excluded.next_transaction_date, creem_subscriptions.next_transaction_date),
            current_period_start_date = coalesce(excluded.current_period_start_date, creem_subscriptions.current_period_start_date),
            current_period_end_date = coalesce(excluded.current_period_end_date, creem_subscriptions.current_period_end_date),
            canceled_at = coalesce(excluded.canceled_at, creem_subscriptions.canceled_at),
            source_created_at = coalesce(excluded.source_created_at, creem_subscriptions.source_created_at),
            source_updated_at = coalesce(excluded.source_updated_at, creem_subscriptions.source_updated_at),
            source = excluded.source,
            raw = excluded.raw,
            updated_at = now()
    `,
    [
      id,
      stringValue(payload.mode),
      stringValue(payload.status),
      entityId(payload.product ?? payload.product_id),
      entityId(payload.customer ?? payload.customer_id),
      stringValue(payload.last_transaction_id),
      parseCreemTime(payload.last_transaction_date),
      parseCreemTime(payload.next_transaction_date),
      parseCreemTime(payload.current_period_start_date),
      parseCreemTime(payload.current_period_end_date),
      parseCreemTime(payload.canceled_at),
      parseCreemTime(payload.created_at),
      parseCreemTime(payload.updated_at),
      source,
      JSON.stringify(payload),
    ],
  );
}

async function insertCreemSnapshot(raw = {}) {
  const config = getCreemConfig();
  const revenueResult = await pool.query(
    `
      select
        coalesce(sum(net_amount), 0)::numeric as total_revenue,
        coalesce(sum(net_amount) filter (where source_created_at >= date_trunc('day', now())), 0)::numeric as today_revenue,
        count(*)::int as transaction_count
      from (
        select
          source_created_at,
          case
            when status in ('refunded', 'chargeback') then 0
            else greatest(coalesce(amount_paid, amount, 0) - coalesce(refunded_amount, 0), 0) / 100.0
          end as net_amount
        from creem_transactions
        where currency = $1 and status in ('paid', 'partially_refunded', 'refunded', 'chargeback')
      ) tx
    `,
    [config.currency],
  );
  const countResult = await pool.query(
    `
      select
        (select count(*)::int from creem_customers) as customer_count,
        (select count(*)::int from creem_subscriptions where status in ('active', 'trialing')) as active_subscription_count,
        (select count(*)::int from creem_subscriptions where status in ('past_due', 'unpaid', 'expired')) as past_due_subscription_count
    `,
  );
  const values = {
    currency: config.currency,
    totalRevenue: roundMoney(Number(revenueResult.rows[0]?.total_revenue ?? 0)),
    todayRevenue: roundMoney(Number(revenueResult.rows[0]?.today_revenue ?? 0)),
    transactionCount: Number(revenueResult.rows[0]?.transaction_count ?? 0),
    customerCount: Number(countResult.rows[0]?.customer_count ?? 0),
    activeSubscriptionCount: Number(countResult.rows[0]?.active_subscription_count ?? 0),
    pastDueSubscriptionCount: Number(countResult.rows[0]?.past_due_subscription_count ?? 0),
    raw,
  };

  const insertResult = await pool.query(
    `
      insert into creem_store_snapshots (
        currency, total_revenue, today_revenue, transaction_count, customer_count,
        active_subscription_count, past_due_subscription_count, raw
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
      returning *
    `,
    [
      values.currency,
      values.totalRevenue,
      values.todayRevenue,
      values.transactionCount,
      values.customerCount,
      values.activeSubscriptionCount,
      values.pastDueSubscriptionCount,
      JSON.stringify(values.raw),
    ],
  );

  return insertResult.rows[0];
}

async function createCreemRecentTransactionsResult({ dataSource, metric }) {
  const result = await pool.query(
    `
      select id, type, status, amount, amount_paid, refunded_amount, currency, order_id,
             subscription_id, customer_id, description, source_created_at, updated_at
      from creem_transactions
      order by coalesce(source_created_at, updated_at) desc
      limit 20
    `,
  );
  const rows = result.rows.map((row) => ({
    timestamp: Math.floor(new Date(row.source_created_at ?? row.updated_at).getTime() / 1000),
    id: row.id,
    type: row.type ?? "",
    status: row.status ?? "",
    customer_id: row.customer_id ?? "",
    value: centsToMajor(netCents(row)),
    currency: row.currency ?? "",
  }));

  return {
    columns: [
      { key: "timestamp", label: "Time", type: "time" },
      { key: "id", label: "Transaction", type: "string" },
      { key: "type", label: "Type", type: "string" },
      { key: "status", label: "Status", type: "string" },
      { key: "customer_id", label: "Customer", type: "string" },
      { key: "value", label: "Net Amount", type: "number", format: "currency", unit: getCreemConfig().currency },
      { key: "currency", label: "Currency", type: "string" },
    ],
    rows,
    meta: createMeta({ dataSource, metric, previousValue: 0 }),
  };
}

async function createCreemRevenueTrendResult({ dataSource, metric, timeRange }) {
  const { start, stepSeconds } = getRangeWindow(timeRange);
  const config = getCreemConfig();
  const result = await pool.query(
    `
      select source_created_at as paid_at,
             case
               when status in ('refunded', 'chargeback') then 0
               else greatest(coalesce(amount_paid, amount, 0) - coalesce(refunded_amount, 0), 0) / 100.0
             end as value
      from creem_transactions
      where currency = $1
        and status in ('paid', 'partially_refunded', 'refunded', 'chargeback')
        and source_created_at >= $2
      order by paid_at asc
    `,
    [config.currency, start.toISOString()],
  );
  const buckets = new Map();

  for (const row of result.rows) {
    const seconds = Math.floor(new Date(row.paid_at).getTime() / 1000);
    const bucket = Math.floor(seconds / stepSeconds) * stepSeconds;
    buckets.set(bucket, (buckets.get(bucket) ?? 0) + Number(row.value ?? 0));
  }

  const rows = Array.from(buckets.entries())
    .sort(([a], [b]) => a - b)
    .map(([timestamp, value]) => ({ timestamp, value: roundMoney(value) }));
  const latest = Number(rows.at(-1)?.value ?? 0);
  const previous = Number(rows.at(-2)?.value ?? latest);

  return {
    columns: [
      { key: "timestamp", label: "Time", type: "time" },
      { key: "value", label: metric.name, type: "number", format: "currency", unit: config.currency },
    ],
    rows,
    meta: createMeta({ dataSource, metric, previousValue: previous }),
  };
}

async function createCreemSnapshotKpiResult({ dataSource, metric }) {
  const snapshot = await getLatestCreemSnapshot();
  const rows = [];
  let value = 0;

  switch (metric.key) {
    case "creem_today_revenue":
      value = Number(snapshot?.today_revenue ?? 0);
      break;
    case "creem_total_revenue":
      value = Number(snapshot?.total_revenue ?? 0);
      break;
    case "creem_customer_count":
      value = Number(snapshot?.customer_count ?? 0);
      break;
    case "creem_active_subscriptions":
      value = Number(snapshot?.active_subscription_count ?? 0);
      break;
    case "creem_transaction_count":
      value = Number(snapshot?.transaction_count ?? 0);
      break;
    default:
      value = 0;
  }

  if (snapshot) {
    rows.push({
      timestamp: Math.floor(new Date(snapshot.captured_at).getTime() / 1000),
      value,
    });
  }

  return {
    columns: [
      { key: "timestamp", label: "Time", type: "time" },
      { key: "value", label: metric.name, type: "number", format: metric.format, unit: getCreemConfig().currency },
    ],
    rows,
    meta: createMeta({ dataSource, metric, previousValue: value }),
  };
}

async function getLatestCreemSnapshot() {
  const result = await pool.query(
    `
      select *
      from creem_store_snapshots
      order by captured_at desc
      limit 1
    `,
  );
  return result.rows[0] ?? null;
}

async function runScheduledCreemSync() {
  if (schedulerState.running) {
    return;
  }

  schedulerState.running = true;
  schedulerState.lastStartedAt = new Date().toISOString();
  schedulerState.nextRunAt = new Date(Date.now() + schedulerState.intervalMs).toISOString();

  try {
    const config = getCreemConfig();
    if (!config.configured) {
      schedulerState.lastErrorAt = new Date().toISOString();
      schedulerState.lastError = "Creem API key is not configured";
      return;
    }

    const result = await syncCreem({
      maxPages: schedulerState.maxPages,
      pageSize: schedulerState.pageSize,
    });

    schedulerState.lastSuccessAt = new Date().toISOString();
    schedulerState.lastError = null;
    schedulerState.lastResult = {
      syncedTransactions: result.syncedTransactions,
      syncedCustomers: result.syncedCustomers,
      syncedSubscriptions: result.syncedSubscriptions,
    };
  } finally {
    schedulerState.running = false;
    schedulerState.lastFinishedAt = new Date().toISOString();
  }
}

function createMeta({ dataSource, metric, previousValue }) {
  return {
    metric,
    dataSource,
    unit: metric.format === "currency" ? getCreemConfig().currency : metric.unit,
    freshness: "live",
    generatedAt: new Date().toISOString(),
    previousValue,
  };
}

function createTransactionFromOrder(order) {
  if (!order || typeof order !== "object") {
    return {};
  }

  return {
    id: order.transaction ?? order.id,
    mode: order.mode,
    type: order.type ?? "payment",
    status: order.status,
    amount: order.amount,
    amount_paid: order.amount_paid ?? order.amount_due ?? order.amount,
    discount_amount: order.discount_amount,
    tax_amount: order.tax_amount,
    currency: order.currency,
    order: order.id,
    customer: order.customer,
    product: order.product,
    created_at: order.created_at,
    raw_order: order,
  };
}

function verifyCreemSignature(rawBody, signature, secret) {
  if (!signature || !secret) {
    return false;
  }

  const computed = createHmac("sha256", secret).update(rawBody).digest("hex");
  const left = Buffer.from(computed, "hex");
  const right = Buffer.from(String(signature), "hex");

  if (left.length !== right.length) {
    return false;
  }

  return timingSafeEqual(left, right);
}

function extractItems(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }
  for (const key of ["items", "data", "results", "transactions", "customers", "subscriptions"]) {
    if (Array.isArray(payload?.[key])) {
      return payload[key];
    }
  }
  return [];
}

function assertConfigured() {
  const config = getCreemConfig();
  if (!config.configured) {
    const error = new Error("Creem is not configured. Set CREEM_API_KEY.");
    error.status = 409;
    throw error;
  }
  return config;
}

function assertWebhookConfigured() {
  const config = getCreemConfig();
  if (!config.webhookConfigured) {
    const error = new Error("Creem webhook is not configured. Set CREEM_WEBHOOK_SECRET.");
    error.status = 409;
    throw error;
  }
  return config;
}

function parseCreemTime(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (typeof value === "number") {
    const milliseconds = value > 10_000_000_000 ? value : value * 1000;
    return new Date(milliseconds).toISOString();
  }

  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function entityId(value) {
  if (!value) {
    return null;
  }
  if (typeof value === "object") {
    return stringValue(value.id);
  }
  return stringValue(value);
}

function stringValue(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  return String(value);
}

function nullableInt(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  return Number.parseInt(String(value), 10);
}

function netCents(row) {
  if (row.status === "refunded" || row.status === "chargeback") {
    return 0;
  }
  return Math.max(Number(row.amount_paid ?? row.amount ?? 0) - Number(row.refunded_amount ?? 0), 0);
}

function centsToMajor(value) {
  return roundMoney(Number(value ?? 0) / 100);
}

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function readBooleanEnv(key, defaultValue) {
  const value = process.env[key];
  if (value === undefined || value === "") {
    return defaultValue;
  }
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function readIntegerEnv(key, defaultValue) {
  const value = Number.parseInt(String(process.env[key] ?? ""), 10);
  return Number.isFinite(value) ? value : defaultValue;
}

function getRangeWindow(timeRange) {
  const now = Date.now();
  const config = {
    "1h": { durationMs: 60 * 60 * 1000, stepSeconds: 5 * 60 },
    "1d": { durationMs: 24 * 60 * 60 * 1000, stepSeconds: 60 * 60 },
    "1w": { durationMs: 7 * 24 * 60 * 60 * 1000, stepSeconds: 6 * 60 * 60 },
    "1m": { durationMs: 30 * 24 * 60 * 60 * 1000, stepSeconds: 24 * 60 * 60 },
    all: { durationMs: 365 * 24 * 60 * 60 * 1000, stepSeconds: 24 * 60 * 60 },
  }[timeRange] ?? { durationMs: 24 * 60 * 60 * 1000, stepSeconds: 60 * 60 };

  return {
    start: new Date(now - config.durationMs),
    stepSeconds: config.stepSeconds,
  };
}
