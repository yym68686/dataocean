import { createSign, createVerify } from "node:crypto";
import { pool } from "./database.js";

const DEFAULT_BASE_URL = "https://pay.lxsd.cn";
const DEFAULT_SYNC_INTERVAL_MS = 60_000;
const DEFAULT_SYNC_MAX_PAGES = 4;
const DEFAULT_SYNC_LIMIT = 50;

const schedulerState = {
  enabled: false,
  intervalMs: 0,
  maxPages: DEFAULT_SYNC_MAX_PAGES,
  limit: DEFAULT_SYNC_LIMIT,
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

export function getZhupayConfig() {
  const pid = process.env.ZHUPAY_PID?.trim();
  const merchantPrivateKey = normalizePem(process.env.ZHUPAY_MERCHANT_PRIVATE_KEY);
  const platformPublicKey = normalizePem(process.env.ZHUPAY_PLATFORM_PUBLIC_KEY);
  const baseUrl = (process.env.ZHUPAY_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");

  return {
    baseUrl,
    pid,
    merchantPrivateKey,
    platformPublicKey,
    configured: Boolean(pid && merchantPrivateKey && platformPublicKey),
  };
}

export async function getZhupayStatus() {
  const config = getZhupayConfig();
  const [snapshotResult, orderResult] = await Promise.all([
    pool.query("select captured_at, raw from zhupay_merchant_snapshots order by captured_at desc limit 1"),
    pool.query("select count(*)::int as count, max(updated_at) as last_order_at from zhupay_orders"),
  ]);

  return {
    configured: config.configured,
    baseUrl: config.baseUrl,
    pidConfigured: Boolean(config.pid),
    merchantPrivateKeyConfigured: Boolean(config.merchantPrivateKey),
    platformPublicKeyConfigured: Boolean(config.platformPublicKey),
    lastSnapshotAt: snapshotResult.rows[0]?.captured_at ?? null,
    lastSnapshot: snapshotResult.rows[0]?.raw ?? null,
    orderCount: Number(orderResult.rows[0]?.count ?? 0),
    lastOrderAt: orderResult.rows[0]?.last_order_at ?? null,
    scheduler: getZhupaySchedulerStatus(),
  };
}

export function startZhupayScheduler() {
  if (schedulerState.timer || schedulerState.initialTimer) {
    return getZhupaySchedulerStatus();
  }

  const enabled = readBooleanEnv("ZHUPAY_SYNC_ENABLED", false);
  const intervalMs = readIntegerEnv("ZHUPAY_SYNC_INTERVAL_MS", DEFAULT_SYNC_INTERVAL_MS);

  schedulerState.enabled = enabled && intervalMs > 0;
  schedulerState.intervalMs = intervalMs;
  schedulerState.maxPages = readIntegerEnv("ZHUPAY_SYNC_MAX_PAGES", DEFAULT_SYNC_MAX_PAGES);
  schedulerState.limit = readIntegerEnv("ZHUPAY_SYNC_LIMIT", DEFAULT_SYNC_LIMIT);

  if (!schedulerState.enabled) {
    return getZhupaySchedulerStatus();
  }

  const run = () => {
    runScheduledZhupaySync().catch((error) => {
      schedulerState.lastErrorAt = new Date().toISOString();
      schedulerState.lastError = error.message ?? "Scheduled Zhupay sync failed";
      console.warn("[zhupay] scheduled sync failed", schedulerState.lastError);
    });
  };

  const initialDelayMs = readIntegerEnv("ZHUPAY_SYNC_INITIAL_DELAY_MS", 5_000);
  schedulerState.nextRunAt = new Date(Date.now() + Math.max(initialDelayMs, 0)).toISOString();
  schedulerState.initialTimer = setTimeout(() => {
    schedulerState.initialTimer = null;
    run();
  }, Math.max(initialDelayMs, 0));
  schedulerState.initialTimer.unref?.();

  schedulerState.timer = setInterval(run, schedulerState.intervalMs);
  schedulerState.timer.unref?.();

  console.log(
    `[zhupay] scheduled sync enabled interval=${schedulerState.intervalMs}ms maxPages=${schedulerState.maxPages} limit=${schedulerState.limit}`,
  );

  return getZhupaySchedulerStatus();
}

export function getZhupaySchedulerStatus() {
  return {
    enabled: schedulerState.enabled,
    intervalMs: schedulerState.intervalMs,
    maxPages: schedulerState.maxPages,
    limit: schedulerState.limit,
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

export async function syncZhupay({ maxPages = 4, limit = 50 } = {}) {
  assertConfigured();

  const merchantInfo = await callZhupay("/api/merchant/info", {});
  await insertMerchantSnapshot(merchantInfo);

  let offset = 0;
  let orderCount = 0;
  const pageLimit = Math.min(Math.max(Number(limit) || 50, 1), 50);
  const pageCount = Math.min(Math.max(Number(maxPages) || 1, 1), 20);

  for (let page = 0; page < pageCount; page += 1) {
    const payload = await callZhupay("/api/merchant/orders", {
      offset,
      limit: pageLimit,
      status: 1,
    });
    const orders = Array.isArray(payload.data) ? payload.data : [];

    for (const order of orders) {
      await upsertZhupayOrder(order, "sync");
    }

    orderCount += orders.length;
    if (orders.length < pageLimit) {
      break;
    }
    offset += pageLimit;
  }

  return {
    ok: true,
    merchantInfo,
    syncedOrders: orderCount,
  };
}

async function runScheduledZhupaySync() {
  if (schedulerState.running) {
    return;
  }

  schedulerState.running = true;
  schedulerState.lastStartedAt = new Date().toISOString();
  schedulerState.nextRunAt = new Date(Date.now() + schedulerState.intervalMs).toISOString();

  try {
    const config = getZhupayConfig();
    if (!config.configured) {
      schedulerState.lastErrorAt = new Date().toISOString();
      schedulerState.lastError = "Zhupay credentials are not configured";
      return;
    }

    const result = await syncZhupay({
      maxPages: schedulerState.maxPages,
      limit: schedulerState.limit,
    });

    schedulerState.lastSuccessAt = new Date().toISOString();
    schedulerState.lastError = null;
    schedulerState.lastResult = {
      syncedOrders: result.syncedOrders,
      merchantInfoCaptured: Boolean(result.merchantInfo),
    };
  } finally {
    schedulerState.running = false;
    schedulerState.lastFinishedAt = new Date().toISOString();
  }
}

export async function handleZhupayNotify(query) {
  const config = assertConfigured();
  const payload = normalizePayload(query);

  if (!verifyPayload(payload, config.platformPublicKey)) {
    const error = new Error("Invalid Zhupay notify signature");
    error.status = 400;
    throw error;
  }

  if (payload.trade_status !== "TRADE_SUCCESS") {
    const error = new Error("Ignored non-success Zhupay notification");
    error.status = 202;
    throw error;
  }

  await upsertZhupayOrder({ ...payload, status: 1 }, "notify");
  return { ok: true };
}

export async function queryZhupayMetric({ dataSource, metric, query }) {
  const key = metric.key;

  if (key === "zhupay_recent_orders") {
    return createRecentOrdersResult({ dataSource, metric });
  }

  if (key === "zhupay_revenue_trend") {
    return createRevenueTrendResult({ dataSource, metric, timeRange: query.timeRange });
  }

  return createSnapshotKpiResult({ dataSource, metric });
}

export async function createRecentOrdersResult({ dataSource, metric }) {
  const result = await pool.query(
    `
      select trade_no, out_trade_no, type, status, name, money, addtime, endtime, updated_at
      from zhupay_orders
      order by coalesce(endtime, addtime, updated_at) desc
      limit 20
    `,
  );

  const rows = result.rows.map((row) => ({
    timestamp: Math.floor(new Date(row.endtime ?? row.addtime ?? row.updated_at).getTime() / 1000),
    trade_no: row.trade_no,
    out_trade_no: row.out_trade_no ?? "",
    type: row.type ?? "",
    status: Number(row.status ?? 0),
    name: row.name ?? "",
    value: Number(row.money ?? 0),
  }));

  return {
    columns: [
      { key: "timestamp", label: "Time", type: "time" },
      { key: "trade_no", label: "Trade No", type: "string" },
      { key: "out_trade_no", label: "Order No", type: "string" },
      { key: "type", label: "Type", type: "string" },
      { key: "status", label: "Status", type: "number" },
      { key: "name", label: "Product", type: "string" },
      { key: "value", label: "Amount", type: "number", format: "currency", unit: "CNY" },
    ],
    rows,
    meta: createMeta({ dataSource, metric, previousValue: 0 }),
  };
}

export async function createRevenueTrendResult({ dataSource, metric, timeRange }) {
  const { start, stepSeconds } = getRangeWindow(timeRange);
  const result = await pool.query(
    `
      select coalesce(endtime, addtime, updated_at) as paid_at, money
      from zhupay_orders
      where status = 1 and coalesce(endtime, addtime, updated_at) >= $1
      order by paid_at asc
    `,
    [start.toISOString()],
  );
  const buckets = new Map();

  for (const row of result.rows) {
    const seconds = Math.floor(new Date(row.paid_at).getTime() / 1000);
    const bucket = Math.floor(seconds / stepSeconds) * stepSeconds;
    buckets.set(bucket, (buckets.get(bucket) ?? 0) + Number(row.money ?? 0));
  }

  const rows = Array.from(buckets.entries())
    .sort(([a], [b]) => a - b)
    .map(([timestamp, value]) => ({ timestamp, value: roundMoney(value) }));
  const latest = Number(rows.at(-1)?.value ?? 0);
  const previous = Number(rows.at(-2)?.value ?? latest);

  return {
    columns: [
      { key: "timestamp", label: "Time", type: "time" },
      { key: "value", label: metric.name, type: "number", format: "currency" },
    ],
    rows,
    meta: createMeta({ dataSource, metric, previousValue: previous }),
  };
}

export async function createSnapshotKpiResult({ dataSource, metric }) {
  const snapshot = await getLatestSnapshot();
  const rows = [];
  let value = 0;
  let previousValue = 0;

  switch (metric.key) {
    case "zhupay_today_revenue":
      value = Number(snapshot?.order_money_today ?? 0);
      previousValue = Number(snapshot?.order_money_lastday ?? 0);
      break;
    case "zhupay_balance":
      value = Number(snapshot?.balance ?? 0);
      previousValue = value;
      break;
    case "zhupay_today_orders":
      value = Number(snapshot?.order_num_today ?? 0);
      previousValue = Number(snapshot?.order_num_lastday ?? 0);
      break;
    case "zhupay_total_orders":
      value = Number(snapshot?.order_num ?? 0);
      previousValue = value;
      break;
    default:
      value = 0;
      previousValue = 0;
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
      { key: "value", label: metric.name, type: "number", format: metric.format },
    ],
    rows,
    meta: createMeta({ dataSource, metric, previousValue }),
  };
}

export async function listZhupayOrders({ limit = 50 } = {}) {
  const result = await pool.query(
    `
      select trade_no, out_trade_no, api_trade_no, type, status, name, money, addtime, endtime, source, updated_at
      from zhupay_orders
      order by coalesce(endtime, addtime, updated_at) desc
      limit $1
    `,
    [Math.min(Math.max(Number(limit) || 50, 1), 200)],
  );
  return result.rows;
}

export async function getZhupaySummary() {
  const snapshot = await getLatestSnapshot();
  const revenue = await pool.query(
    `
      select
        coalesce(sum(money) filter (where status = 1), 0)::numeric as total_revenue,
        count(*) filter (where status = 1)::int as paid_orders
      from zhupay_orders
    `,
  );

  return {
    snapshot,
    totalRevenue: Number(revenue.rows[0]?.total_revenue ?? 0),
    paidOrders: Number(revenue.rows[0]?.paid_orders ?? 0),
  };
}

async function callZhupay(path, params) {
  const config = assertConfigured();
  const payload = {
    pid: config.pid,
    ...params,
    timestamp: Math.floor(Date.now() / 1000).toString(),
    sign_type: "RSA",
  };
  payload.sign = signPayload(payload, config.merchantPrivateKey);

  const response = await fetch(`${config.baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(stringifyPayload(payload)),
  });
  const text = await response.text();
  let json;

  try {
    json = JSON.parse(text);
  } catch {
    const error = new Error(`Invalid Zhupay JSON response: ${text.slice(0, 160)}`);
    error.status = 502;
    throw error;
  }

  if (!response.ok || Number(json.code) !== 0) {
    const error = new Error(json.msg || `Zhupay request failed with ${response.status}`);
    error.status = 502;
    error.payload = json;
    throw error;
  }

  if (json.sign && !verifyPayload(json, config.platformPublicKey)) {
    const error = new Error("Invalid Zhupay response signature");
    error.status = 502;
    error.payload = json;
    throw error;
  }

  return json;
}

async function insertMerchantSnapshot(payload) {
  await pool.query(
    `
      insert into zhupay_merchant_snapshots (
        pid, status, pay_status, settle_status, balance, order_num,
        order_num_today, order_num_lastday, order_money_today, order_money_lastday, raw
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
    `,
    [
      payload.pid ? String(payload.pid) : null,
      nullableInt(payload.status),
      nullableInt(payload.pay_status),
      nullableInt(payload.settle_status),
      nullableMoney(payload.money),
      nullableInt(payload.order_num),
      nullableInt(payload.order_num_today),
      nullableInt(payload.order_num_lastday),
      nullableMoney(payload.order_money_today),
      nullableMoney(payload.order_money_lastday),
      JSON.stringify(payload),
    ],
  );
}

async function upsertZhupayOrder(payload, source) {
  const tradeNo = String(payload.trade_no ?? "").trim();
  if (!tradeNo) {
    return;
  }

  await pool.query(
    `
      insert into zhupay_orders (
        trade_no, out_trade_no, api_trade_no, pid, type, status, trade_status,
        name, money, refund_money, param, buyer, clientip, addtime, endtime, source, raw
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17::jsonb)
      on conflict (trade_no) do update
        set out_trade_no = excluded.out_trade_no,
            api_trade_no = excluded.api_trade_no,
            pid = excluded.pid,
            type = excluded.type,
            status = excluded.status,
            trade_status = excluded.trade_status,
            name = excluded.name,
            money = excluded.money,
            refund_money = excluded.refund_money,
            param = excluded.param,
            buyer = excluded.buyer,
            clientip = excluded.clientip,
            addtime = excluded.addtime,
            endtime = excluded.endtime,
            source = excluded.source,
            raw = excluded.raw,
            updated_at = now()
    `,
    [
      tradeNo,
      emptyToNull(payload.out_trade_no),
      emptyToNull(payload.api_trade_no),
      payload.pid ? String(payload.pid) : null,
      emptyToNull(payload.type),
      nullableInt(payload.status ?? (payload.trade_status === "TRADE_SUCCESS" ? 1 : null)),
      emptyToNull(payload.trade_status),
      emptyToNull(payload.name),
      nullableMoney(payload.money),
      nullableMoney(payload.refundmoney ?? payload.refund_money),
      emptyToNull(payload.param),
      emptyToNull(payload.buyer),
      emptyToNull(payload.clientip),
      parseZhupayTime(payload.addtime),
      parseZhupayTime(payload.endtime),
      source,
      JSON.stringify(payload),
    ],
  );
}

async function getLatestSnapshot() {
  const result = await pool.query(
    `
      select *
      from zhupay_merchant_snapshots
      order by captured_at desc
      limit 1
    `,
  );
  return result.rows[0] ?? null;
}

function createMeta({ dataSource, metric, previousValue }) {
  return {
    metric,
    dataSource,
    unit: metric.unit,
    freshness: "live",
    generatedAt: new Date().toISOString(),
    previousValue,
  };
}

function signPayload(payload, privateKey) {
  const signingText = createSigningText(payload);
  const signer = createSign("RSA-SHA256");
  signer.update(signingText);
  signer.end();
  return signer.sign(privateKey, "base64");
}

function verifyPayload(payload, publicKey) {
  const signature = payload.sign;
  if (!signature) {
    return false;
  }

  const verifier = createVerify("RSA-SHA256");
  verifier.update(createSigningText(payload));
  verifier.end();
  return verifier.verify(publicKey, signature, "base64");
}

function createSigningText(payload) {
  return Object.entries(payload)
    .filter(([key, value]) => key !== "sign" && key !== "sign_type" && value !== undefined && value !== null && value !== "")
    .filter(([, value]) => !Array.isArray(value) && !(value instanceof Uint8Array))
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, value]) => `${key}=${String(value)}`)
    .join("&");
}

function normalizePayload(query) {
  return Object.fromEntries(
    Object.entries(query).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]),
  );
}

function stringifyPayload(payload) {
  return Object.fromEntries(Object.entries(payload).map(([key, value]) => [key, String(value)]));
}

function normalizePem(value) {
  if (!value) {
    return "";
  }
  return value.replace(/\\n/g, "\n").trim();
}

function assertConfigured() {
  const config = getZhupayConfig();
  if (!config.configured) {
    const error = new Error("Zhupay is not configured. Set ZHUPAY_PID, ZHUPAY_MERCHANT_PRIVATE_KEY, and ZHUPAY_PLATFORM_PUBLIC_KEY.");
    error.status = 409;
    throw error;
  }
  return config;
}

function nullableMoney(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  return roundMoney(Number(value));
}

function nullableInt(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  return Number.parseInt(String(value), 10);
}

function emptyToNull(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  return String(value);
}

function parseZhupayTime(value) {
  if (!value) {
    return null;
  }
  const normalized = String(value).trim().replace(" ", "T");
  return `${normalized}+08:00`;
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
