import { pool } from "./database.js";
import { getFxRate, getReportingCurrency, normalizeCurrency, roundMoney } from "./currency.js";

export async function queryRevenueMetric({ dataSource, metric, query }) {
  if (metric.key === "aggregate_revenue_trend") {
    return createAggregateRevenueTrendResult({ dataSource, metric, timeRange: query.timeRange });
  }

  return createAggregateKpiResult({ dataSource, metric });
}

async function createAggregateKpiResult({ dataSource, metric }) {
  const reportingCurrency = getReportingCurrency();
  const totals = await getRevenueTotals(reportingCurrency);
  const rows = [];
  let value = 0;

  switch (metric.key) {
    case "aggregate_today_revenue":
      value = totals.todayRevenue;
      break;
    case "aggregate_total_revenue":
      value = totals.totalRevenue;
      break;
    case "aggregate_transaction_count":
      value = totals.transactionCount;
      break;
    case "aggregate_customer_count":
      value = totals.customerCount;
      break;
    default:
      value = 0;
  }

  if (totals.hasAnyData) {
    rows.push({
      timestamp: Math.floor(Date.now() / 1000),
      value,
    });
  }

  return {
    columns: [
      { key: "timestamp", label: "Time", type: "time" },
      { key: "value", label: metric.name, type: "number", format: metric.format, unit: metric.unit },
    ],
    rows,
    meta: createMeta({ dataSource, metric, previousValue: value, warnings: totals.warnings }),
  };
}

async function createAggregateRevenueTrendResult({ dataSource, metric, timeRange }) {
  const reportingCurrency = getReportingCurrency();
  const { start, stepSeconds } = getRangeWindow(timeRange);
  const warnings = [];
  const seriesBuckets = new Map();
  const totalBuckets = new Map();

  const zhupayRate = getFxRate("CNY", reportingCurrency);
  if (zhupayRate === null) {
    warnings.push(`Missing DATAOCEAN_FX_CNY_TO_${reportingCurrency}; Zhupay is excluded from aggregate total.`);
  } else {
    const zhupay = await pool.query(
      `
        select coalesce(endtime, addtime, updated_at) as paid_at, money
        from zhupay_orders
        where status = 1 and coalesce(endtime, addtime, updated_at) >= $1
        order by paid_at asc
      `,
      [start.toISOString()],
    );
    addRowsToBuckets({
      rows: zhupay.rows,
      seriesName: "Zhupay",
      stepSeconds,
      rate: zhupayRate,
      seriesBuckets,
      totalBuckets,
    });
  }

  const creem = await pool.query(
    `
      select source_created_at as paid_at,
             currency,
             case
               when status in ('refunded', 'chargeback') then 0
               else greatest(coalesce(amount_paid, amount, 0) - coalesce(refunded_amount, 0), 0) / 100.0
             end as money
      from creem_transactions
      where status in ('paid', 'partially_refunded', 'refunded', 'chargeback')
        and source_created_at >= $1
      order by paid_at asc
    `,
    [start.toISOString()],
  );

  for (const currency of new Set(creem.rows.map((row) => String(row.currency || reportingCurrency).toUpperCase()))) {
    const rate = getFxRate(currency, reportingCurrency);
    const rows = creem.rows.filter((row) => String(row.currency || reportingCurrency).toUpperCase() === currency);

    if (rate === null) {
      warnings.push(`Missing DATAOCEAN_FX_${currency}_TO_${reportingCurrency}; Creem ${currency} rows are excluded from aggregate total.`);
      continue;
    }

    addRowsToBuckets({
      rows,
      seriesName: "Creem",
      stepSeconds,
      rate,
      seriesBuckets,
      totalBuckets,
    });
  }

  const manual = await pool.query(
    `
      select received_at as paid_at, currency, amount as money
      from manual_revenue_entries
      where received_at >= $1
      order by paid_at asc
    `,
    [start.toISOString()],
  );

  for (const currency of new Set(manual.rows.map((row) => normalizeCurrency(row.currency || reportingCurrency)))) {
    const rate = getFxRate(currency, reportingCurrency);
    const rows = manual.rows.filter((row) => normalizeCurrency(row.currency || reportingCurrency) === currency);

    if (rate === null) {
      warnings.push(`Missing DATAOCEAN_FX_${currency}_TO_${reportingCurrency}; manual ${currency} rows are excluded from aggregate total.`);
      continue;
    }

    addRowsToBuckets({
      rows,
      seriesName: "Manual",
      stepSeconds,
      rate,
      seriesBuckets,
      totalBuckets,
    });
  }

  const rows = [
    ...serializeCumulativeSeriesBuckets(seriesBuckets),
    ...serializeCumulativeBuckets(totalBuckets, "Total"),
  ];
  const totalRows = rows.filter((row) => row.series === "Total");
  const latest = Number(totalRows.at(-1)?.value ?? 0);
  const previous = Number(totalRows.at(-2)?.value ?? latest);

  return {
    columns: [
      { key: "timestamp", label: "Time", type: "time" },
      { key: "series", label: "Provider", type: "string" },
      { key: "value", label: metric.name, type: "number", format: "currency", unit: reportingCurrency },
    ],
    rows,
    meta: createMeta({ dataSource, metric, previousValue: previous, warnings }),
  };
}

async function getRevenueTotals(reportingCurrency) {
  const warnings = [];
  const zhupayRate = getFxRate("CNY", reportingCurrency);
  let totalRevenue = 0;
  let todayRevenue = 0;
  let transactionCount = 0;
  let customerCount = 0;
  let hasAnyData = false;

  const zhupay = await pool.query(`
      select
        coalesce(sum(money), 0)::numeric as total_revenue,
        coalesce(sum(money) filter (where coalesce(endtime, addtime, updated_at) >= date_trunc('day', now())), 0)::numeric as today_revenue,
        count(*)::int as transaction_count
      from zhupay_orders
      where status = 1
    `);
  const row = zhupay.rows[0] ?? {};
  transactionCount += Number(row.transaction_count ?? 0);
  hasAnyData = hasAnyData || Number(row.transaction_count ?? 0) > 0;

  if (zhupayRate === null) {
    warnings.push(`Missing DATAOCEAN_FX_CNY_TO_${reportingCurrency}; Zhupay is excluded from aggregate revenue.`);
  } else {
    totalRevenue += Number(row.total_revenue ?? 0) * zhupayRate;
    todayRevenue += Number(row.today_revenue ?? 0) * zhupayRate;
  }

  const creem = await pool.query(`
    select
      currency,
      coalesce(sum(net_amount), 0)::numeric as total_revenue,
      coalesce(sum(net_amount) filter (where source_created_at >= date_trunc('day', now())), 0)::numeric as today_revenue,
      count(*)::int as transaction_count
    from (
      select
        currency,
        source_created_at,
        case
          when status in ('refunded', 'chargeback') then 0
          else greatest(coalesce(amount_paid, amount, 0) - coalesce(refunded_amount, 0), 0) / 100.0
        end as net_amount
      from creem_transactions
      where status in ('paid', 'partially_refunded', 'refunded', 'chargeback')
    ) tx
    group by currency
  `);
  for (const row of creem.rows) {
    const currency = String(row.currency || reportingCurrency).toUpperCase();
    const rate = getFxRate(currency, reportingCurrency);
    transactionCount += Number(row.transaction_count ?? 0);
    hasAnyData = hasAnyData || Number(row.transaction_count ?? 0) > 0;

    if (rate === null) {
      warnings.push(`Missing DATAOCEAN_FX_${currency}_TO_${reportingCurrency}; Creem ${currency} rows are excluded from aggregate revenue.`);
      continue;
    }
    totalRevenue += Number(row.total_revenue ?? 0) * rate;
    todayRevenue += Number(row.today_revenue ?? 0) * rate;
  }

  const customers = await pool.query("select count(*)::int as count from creem_customers");
  customerCount = Number(customers.rows[0]?.count ?? 0);
  hasAnyData = hasAnyData || customerCount > 0;

  const manual = await pool.query(`
    select
      currency,
      coalesce(sum(amount), 0)::numeric as total_revenue,
      coalesce(sum(amount) filter (where received_at >= date_trunc('day', now())), 0)::numeric as today_revenue,
      count(*)::int as transaction_count
    from manual_revenue_entries
    group by currency
  `);
  for (const row of manual.rows) {
    const currency = normalizeCurrency(row.currency || reportingCurrency);
    const rate = getFxRate(currency, reportingCurrency);
    transactionCount += Number(row.transaction_count ?? 0);
    hasAnyData = hasAnyData || Number(row.transaction_count ?? 0) > 0;

    if (rate === null) {
      warnings.push(`Missing DATAOCEAN_FX_${currency}_TO_${reportingCurrency}; manual ${currency} rows are excluded from aggregate revenue.`);
      continue;
    }
    totalRevenue += Number(row.total_revenue ?? 0) * rate;
    todayRevenue += Number(row.today_revenue ?? 0) * rate;
  }

  return {
    totalRevenue: roundMoney(totalRevenue),
    todayRevenue: roundMoney(todayRevenue),
    transactionCount,
    customerCount,
    hasAnyData,
    warnings,
  };
}

function addRowsToBuckets({ rows, seriesName, stepSeconds, rate, seriesBuckets, totalBuckets }) {
  for (const row of rows) {
    if (!row.paid_at) {
      continue;
    }
    const seconds = Math.floor(new Date(row.paid_at).getTime() / 1000);
    const bucket = Math.floor(seconds / stepSeconds) * stepSeconds;
    const value = Number(row.money ?? 0) * rate;
    const key = `${seriesName}:${bucket}`;

    seriesBuckets.set(key, {
      timestamp: bucket,
      series: seriesName,
      value: (seriesBuckets.get(key)?.value ?? 0) + value,
    });
    totalBuckets.set(bucket, (totalBuckets.get(bucket) ?? 0) + value);
  }
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

function serializeCumulativeBuckets(buckets, series) {
  let cumulative = 0;
  return Array.from(buckets.entries())
    .sort(([a], [b]) => a - b)
    .map(([timestamp, value]) => {
      cumulative += Number(value ?? 0);
      return { timestamp, series, value: roundMoney(cumulative) };
    });
}

function createMeta({ dataSource, metric, previousValue, warnings }) {
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
