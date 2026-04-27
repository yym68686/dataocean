import { randomUUID } from "node:crypto";
import { getFxRate, getReportingCurrency, normalizeCurrency, roundMoney } from "./currency.js";
import { pool } from "./database.js";

const DEFAULT_CHANNEL = "Manual";

export async function getManualRevenueStatus() {
  const reportingCurrency = getReportingCurrency();
  const [summary, lastEntry] = await Promise.all([
    getManualTotals(reportingCurrency),
    pool.query(
      `
        select received_at
        from manual_revenue_entries
        order by received_at desc
        limit 1
      `,
    ),
  ]);

  return {
    configured: true,
    reportingCurrency,
    entryCount: summary.entryCount,
    totalRevenue: summary.totalRevenue,
    todayRevenue: summary.todayRevenue,
    warnings: summary.warnings,
    lastReceivedAt: lastEntry.rows[0]?.received_at ?? null,
  };
}

export async function listManualRevenueEntries({ limit = 100 } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const result = await pool.query(
    `
      select
        e.id,
        e.channel,
        e.amount,
        e.currency,
        e.note,
        e.received_at,
        e.created_at,
        e.updated_at,
        e.created_by,
        u.name as created_by_name,
        u.email as created_by_email
      from manual_revenue_entries e
      left join users u on u.id = e.created_by
      order by e.received_at desc, e.created_at desc
      limit $1
    `,
    [safeLimit],
  );

  return result.rows.map(toManualRevenueEntry);
}

export async function createManualRevenueEntry(input, user) {
  const entry = normalizeEntryInput(input, { requireAmount: true });
  const result = await pool.query(
    `
      insert into manual_revenue_entries (
        id, channel, amount, currency, note, received_at, created_by
      )
      values ($1, $2, $3, $4, $5, $6, $7)
      returning id
    `,
    [
      randomUUID(),
      entry.channel,
      entry.amount,
      entry.currency,
      entry.note,
      entry.receivedAt,
      user.id,
    ],
  );

  return getManualRevenueEntry(result.rows[0].id);
}

export async function updateManualRevenueEntry(id, input, user) {
  const existing = await getManualRevenueEntryRow(id);
  assertCanMutateEntry(existing, user);

  const patch = normalizeEntryInput(input, { requireAmount: false });
  const next = {
    channel: patch.channel ?? existing.channel,
    amount: patch.amount ?? existing.amount,
    currency: patch.currency ?? existing.currency,
    note: Object.prototype.hasOwnProperty.call(patch, "note") ? patch.note : existing.note,
    receivedAt: patch.receivedAt ?? existing.received_at,
  };

  await pool.query(
    `
      update manual_revenue_entries
      set channel = $2,
          amount = $3,
          currency = $4,
          note = $5,
          received_at = $6,
          updated_at = now()
      where id = $1
    `,
    [id, next.channel, next.amount, next.currency, next.note, next.receivedAt],
  );

  return getManualRevenueEntry(id);
}

export async function deleteManualRevenueEntry(id, user) {
  const existing = await getManualRevenueEntryRow(id);
  assertCanMutateEntry(existing, user);
  await pool.query("delete from manual_revenue_entries where id = $1", [id]);
  return { id };
}

export async function queryManualRevenueMetric({ dataSource, metric, query }) {
  if (metric.key === "manual_revenue_trend") {
    return createManualRevenueTrendResult({ dataSource, metric, timeRange: query.timeRange });
  }
  if (metric.key === "manual_recent_entries") {
    return createManualRecentEntriesResult({ dataSource, metric });
  }

  return createManualKpiResult({ dataSource, metric });
}

async function createManualKpiResult({ dataSource, metric }) {
  const reportingCurrency = getReportingCurrency();
  const summary = await getManualTotals(reportingCurrency);
  let value = 0;

  switch (metric.key) {
    case "manual_today_revenue":
      value = summary.todayRevenue;
      break;
    case "manual_total_revenue":
      value = summary.totalRevenue;
      break;
    case "manual_entry_count":
      value = summary.entryCount;
      break;
    default:
      value = 0;
  }

  return {
    columns: [
      { key: "timestamp", label: "Time", type: "time" },
      { key: "value", label: metric.name, type: "number", format: metric.format, unit: metric.unit },
    ],
    rows: summary.hasAnyData ? [{ timestamp: Math.floor(Date.now() / 1000), value }] : [],
    meta: createMeta({ dataSource, metric, previousValue: value, warnings: summary.warnings }),
  };
}

async function createManualRevenueTrendResult({ dataSource, metric, timeRange }) {
  const reportingCurrency = getReportingCurrency();
  const { start, stepSeconds } = getRangeWindow(timeRange);
  const result = await pool.query(
    `
      select received_at, channel, amount, currency
      from manual_revenue_entries
      where received_at >= $1
      order by received_at asc
    `,
    [start.toISOString()],
  );
  const warnings = [];
  const buckets = new Map();

  for (const row of result.rows) {
    const currency = normalizeCurrency(row.currency);
    const rate = getFxRate(currency, reportingCurrency);
    if (rate === null) {
      warnings.push(`Missing DATAOCEAN_FX_${currency}_TO_${reportingCurrency}; manual ${currency} rows are excluded from trend.`);
      continue;
    }
    const seconds = Math.floor(new Date(row.received_at).getTime() / 1000);
    const bucket = Math.floor(seconds / stepSeconds) * stepSeconds;
    const channel = String(row.channel || DEFAULT_CHANNEL);
    const key = `${channel}:${bucket}`;
    buckets.set(key, {
      timestamp: bucket,
      series: channel,
      value: (buckets.get(key)?.value ?? 0) + Number(row.amount ?? 0) * rate,
    });
  }

  const rows = serializeCumulativeSeriesBuckets(buckets);
  const latest = Number(rows.at(-1)?.value ?? 0);
  const previous = Number(rows.at(-2)?.value ?? latest);

  return {
    columns: [
      { key: "timestamp", label: "Time", type: "time" },
      { key: "series", label: "Channel", type: "string" },
      { key: "value", label: metric.name, type: "number", format: "currency", unit: reportingCurrency },
    ],
    rows,
    meta: createMeta({ dataSource, metric, previousValue: previous, warnings }),
  };
}

async function createManualRecentEntriesResult({ dataSource, metric }) {
  const entries = await listManualRevenueEntries({ limit: 20 });

  return {
    columns: [
      { key: "received_at", label: "Received", type: "time" },
      { key: "channel", label: "Channel", type: "string" },
      { key: "amount", label: "Amount", type: "number" },
      { key: "currency", label: "Currency", type: "string" },
      { key: "note", label: "Note", type: "string" },
    ],
    rows: entries.map((entry) => ({
      id: entry.id,
      received_at: Math.floor(new Date(entry.receivedAt).getTime() / 1000),
      channel: entry.channel,
      amount: entry.amount,
      currency: entry.currency,
      note: entry.note ?? "",
    })),
    meta: createMeta({ dataSource, metric, previousValue: entries.length }),
  };
}

async function getManualTotals(reportingCurrency) {
  const result = await pool.query(`
    select
      currency,
      coalesce(sum(amount), 0)::numeric as total_revenue,
      coalesce(sum(amount) filter (where received_at >= date_trunc('day', now())), 0)::numeric as today_revenue,
      count(*)::int as entry_count
    from manual_revenue_entries
    group by currency
  `);
  const warnings = [];
  let totalRevenue = 0;
  let todayRevenue = 0;
  let entryCount = 0;

  for (const row of result.rows) {
    const currency = normalizeCurrency(row.currency || reportingCurrency);
    const rate = getFxRate(currency, reportingCurrency);
    entryCount += Number(row.entry_count ?? 0);

    if (rate === null) {
      warnings.push(`Missing DATAOCEAN_FX_${currency}_TO_${reportingCurrency}; manual ${currency} rows are excluded from totals.`);
      continue;
    }

    totalRevenue += Number(row.total_revenue ?? 0) * rate;
    todayRevenue += Number(row.today_revenue ?? 0) * rate;
  }

  return {
    totalRevenue: roundMoney(totalRevenue),
    todayRevenue: roundMoney(todayRevenue),
    entryCount,
    hasAnyData: entryCount > 0,
    warnings,
  };
}

async function getManualRevenueEntry(id) {
  return toManualRevenueEntry(await getManualRevenueEntryRow(id));
}

async function getManualRevenueEntryRow(id) {
  const result = await pool.query(
    `
      select
        e.id,
        e.channel,
        e.amount,
        e.currency,
        e.note,
        e.received_at,
        e.created_at,
        e.updated_at,
        e.created_by,
        u.name as created_by_name,
        u.email as created_by_email
      from manual_revenue_entries e
      left join users u on u.id = e.created_by
      where e.id = $1
    `,
    [id],
  );
  if (!result.rows[0]) {
    const error = new Error("Manual revenue entry not found");
    error.status = 404;
    throw error;
  }
  return result.rows[0];
}

function normalizeEntryInput(input, { requireAmount }) {
  const output = {};

  if (requireAmount || input.amount !== undefined) {
    const amount = Number(input.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      const error = new Error("Amount must be greater than 0");
      error.status = 400;
      throw error;
    }
    output.amount = amount;
  }

  if (requireAmount || input.currency !== undefined) {
    const currency = normalizeCurrency(input.currency);
    if (!/^[A-Z0-9]{3,12}$/.test(currency)) {
      const error = new Error("Currency must be 3-12 letters or numbers");
      error.status = 400;
      throw error;
    }
    output.currency = currency;
  }

  if (requireAmount || input.channel !== undefined) {
    const channel = String(input.channel || DEFAULT_CHANNEL).trim();
    if (!channel || channel.length > 80) {
      const error = new Error("Channel is required and must be 80 characters or fewer");
      error.status = 400;
      throw error;
    }
    output.channel = channel;
  }

  if (Object.prototype.hasOwnProperty.call(input, "note")) {
    const note = String(input.note ?? "").trim();
    output.note = note ? note.slice(0, 1000) : null;
  }

  if (requireAmount || input.receivedAt !== undefined) {
    const receivedAt = input.receivedAt ? new Date(input.receivedAt) : new Date();
    if (Number.isNaN(receivedAt.getTime())) {
      const error = new Error("Received time is invalid");
      error.status = 400;
      throw error;
    }
    output.receivedAt = receivedAt.toISOString();
  }

  return output;
}

function assertCanMutateEntry(entry, user) {
  if (user.role === "admin" || entry.created_by === user.id) {
    return;
  }
  const error = new Error("You can only change entries created by your account");
  error.status = 403;
  throw error;
}

function toManualRevenueEntry(row) {
  return {
    id: row.id,
    channel: row.channel,
    amount: Number(row.amount ?? 0),
    currency: normalizeCurrency(row.currency),
    note: row.note ?? "",
    receivedAt: row.received_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
    createdByName: row.created_by_name,
    createdByEmail: row.created_by_email,
  };
}

function serializeCumulativeSeriesBuckets(seriesBuckets) {
  const bySeries = new Map();
  for (const row of seriesBuckets.values()) {
    const rows = bySeries.get(row.series) ?? [];
    rows.push(row);
    bySeries.set(row.series, rows);
  }

  const cumulativeRows = [];
  for (const [series, rows] of bySeries.entries()) {
    let cumulative = 0;
    for (const row of rows.sort((left, right) => left.timestamp - right.timestamp)) {
      cumulative += Number(row.value ?? 0);
      cumulativeRows.push({ timestamp: row.timestamp, series, value: roundMoney(cumulative) });
    }
  }

  return cumulativeRows.sort((left, right) => left.timestamp - right.timestamp || left.series.localeCompare(right.series));
}

function createMeta({ dataSource, metric, previousValue, warnings = [] }) {
  const reportingCurrency = getReportingCurrency();
  return {
    metric: { ...metric, unit: metric.format === "currency" ? reportingCurrency : metric.unit },
    dataSource,
    unit: metric.format === "currency" ? reportingCurrency : metric.unit,
    freshness: "live",
    generatedAt: new Date().toISOString(),
    previousValue,
    warnings,
  };
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
