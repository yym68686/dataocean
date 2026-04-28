const DEFAULT_BASE_URL = "https://s2a.ohmycdn.com";
const DEFAULT_CHANNELS = ["codex", "codexplus"];
const DEFAULT_PROFIT_RATE = 0.025;
const DEFAULT_CURRENCY = "USD";
const DEFAULT_START_DATE = "2020-01-01";
const DEFAULT_TIMEZONE = "Asia/Shanghai";
const DEFAULT_CACHE_TTL_MS = 60_000;

const responseCache = new Map();
const connectorState = {
  lastFetchedAt: null,
  lastErrorAt: null,
  lastError: null,
};

export function getSub2ApiConfig() {
  const baseUrl = (process.env.SUB2API_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const adminApiKey = process.env.SUB2API_ADMIN_API_KEY?.trim();
  const channels = (process.env.SUB2API_CHANNELS || DEFAULT_CHANNELS.join(","))
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const profitRate = readNumberEnv("SUB2API_PROFIT_RATE", DEFAULT_PROFIT_RATE);
  const currency = (process.env.SUB2API_CURRENCY || DEFAULT_CURRENCY).trim().toUpperCase();
  const startDate = (process.env.SUB2API_START_DATE || DEFAULT_START_DATE).trim();
  const timezone = (process.env.SUB2API_TIMEZONE || DEFAULT_TIMEZONE).trim();
  const cacheTtlMs = readIntegerEnv("SUB2API_CACHE_TTL_MS", DEFAULT_CACHE_TTL_MS);

  return {
    baseUrl,
    adminApiKey,
    channels: channels.length ? channels : DEFAULT_CHANNELS,
    profitRate,
    currency,
    startDate,
    timezone,
    cacheTtlMs,
    configured: Boolean(adminApiKey),
  };
}

export async function getSub2ApiStatus({ force = false } = {}) {
  const config = getSub2ApiConfig();
  const status = {
    configured: config.configured,
    baseUrl: config.baseUrl,
    channels: config.channels,
    profitRate: config.profitRate,
    currency: config.currency,
    startDate: config.startDate,
    timezone: config.timezone,
    cacheTtlMs: config.cacheTtlMs,
    lastFetchedAt: connectorState.lastFetchedAt,
    lastErrorAt: connectorState.lastErrorAt,
    lastError: connectorState.lastError,
  };

  if (!config.configured) {
    return status;
  }

  try {
    const summary = await getSub2ApiSummary({ force });
    return {
      ...status,
      totalCost: summary.totalCost,
      totalProfit: summary.totalProfit,
      todayCost: summary.todayCost,
      todayProfit: summary.todayProfit,
      requestCount: summary.requestCount,
      channelCount: summary.channels.length,
      lastFetchedAt: connectorState.lastFetchedAt,
      lastErrorAt: connectorState.lastErrorAt,
      lastError: connectorState.lastError,
    };
  } catch (error) {
    return {
      ...status,
      lastErrorAt: connectorState.lastErrorAt,
      lastError: error instanceof Error ? error.message : "Sub2API status check failed",
    };
  }
}

export async function syncSub2Api() {
  responseCache.clear();
  const summary = await getSub2ApiSummary({ force: true });
  return {
    ok: true,
    summary,
  };
}

export async function querySub2ApiMetric({ dataSource, metric, query }) {
  if (metric.key === "sub2api_profit_trend") {
    return createSub2ApiProfitTrendResult({ dataSource, metric, timeRange: query.timeRange });
  }

  if (metric.key === "sub2api_channel_breakdown") {
    return createSub2ApiChannelBreakdownResult({ dataSource, metric });
  }

  return createSub2ApiKpiResult({ dataSource, metric });
}

export async function getSub2ApiSummary({ force = false } = {}) {
  const config = assertConfigured();
  const today = getDateInTimezone(new Date(), config.timezone);
  const [totalChannels, todayChannels] = await Promise.all([
    getChannelStats({ startDate: config.startDate, endDate: today, force }),
    getChannelStats({ startDate: today, endDate: today, force }),
  ]);
  const todayByName = new Map(todayChannels.map((channel) => [normalizeKey(channel.name), channel]));

  const channels = totalChannels.map((channel) => {
    const todayChannel = todayByName.get(normalizeKey(channel.name));
    const totalCost = roundMoney(channel.actualCost);
    const todayCost = roundMoney(todayChannel?.actualCost ?? 0);
    return {
      id: channel.id,
      name: channel.name,
      totalCost,
      todayCost,
      totalProfit: roundMoney(totalCost * config.profitRate),
      todayProfit: roundMoney(todayCost * config.profitRate),
      requestCount: Number(channel.requests ?? 0),
      todayRequests: Number(todayChannel?.requests ?? 0),
    };
  });

  return {
    channels,
    totalCost: roundMoney(sum(channels, "totalCost")),
    todayCost: roundMoney(sum(channels, "todayCost")),
    totalProfit: roundMoney(sum(channels, "totalProfit")),
    todayProfit: roundMoney(sum(channels, "todayProfit")),
    requestCount: sum(channels, "requestCount"),
    todayRequests: sum(channels, "todayRequests"),
    profitRate: config.profitRate,
    currency: config.currency,
    generatedAt: new Date().toISOString(),
  };
}

export async function getSub2ApiAggregateProfitRows({ timeRange }) {
  const rows = await createProfitTrendRows({ timeRange });
  return rows
    .filter((row) => row.series === "Total")
    .map((row) => ({
      timestamp: row.timestamp,
      series: "Sub2API",
      value: row.value,
    }));
}

export async function getSub2ApiRevenueEntryRows({ timeRange }) {
  const config = assertConfigured();
  const rows = await createProfitTrendRows({ timeRange });
  return rows
    .filter((row) => row.series !== "Total" && Number(row.value ?? 0) > 0)
    .sort((left, right) => Number(right.timestamp) - Number(left.timestamp) || String(left.series).localeCompare(String(right.series)))
    .slice(0, 50)
    .map((row) => ({
      id: `Sub2API:${row.series}:${row.timestamp}`,
      received_at: row.timestamp,
      provider: "Sub2API",
      channel: String(row.series),
      amount: roundMoney(row.value),
      currency: config.currency,
      normalized_value: roundMoney(row.value),
      note: `${roundPercent(config.profitRate)} of Sub2API spend`,
    }));
}

async function createSub2ApiKpiResult({ dataSource, metric }) {
  const config = assertConfigured();
  const summary = await getSub2ApiSummary();
  let value = 0;

  switch (metric.key) {
    case "sub2api_today_profit":
      value = summary.todayProfit;
      break;
    case "sub2api_total_profit":
      value = summary.totalProfit;
      break;
    case "sub2api_total_spend":
      value = summary.totalCost;
      break;
    case "sub2api_request_count":
      value = summary.requestCount;
      break;
    default:
      value = 0;
  }

  return {
    columns: [
      { key: "timestamp", label: "Time", type: "time" },
      { key: "value", label: metric.name, type: "number", format: metric.format, unit: metric.unit },
    ],
    rows: summary.requestCount > 0 || summary.totalCost > 0
      ? [{ timestamp: Math.floor(Date.now() / 1000), value }]
      : [],
    meta: createMeta({
      config,
      dataSource,
      metric,
      previousValue: value,
    }),
  };
}

async function createSub2ApiProfitTrendResult({ dataSource, metric, timeRange }) {
  const config = assertConfigured();
  const rows = await createProfitTrendRows({ timeRange });
  const totalRows = rows.filter((row) => row.series === "Total");
  const latest = Number(totalRows.at(-1)?.value ?? 0);
  const previous = Number(totalRows.at(-2)?.value ?? latest);

  return {
    columns: [
      { key: "timestamp", label: "Time", type: "time" },
      { key: "series", label: "Channel", type: "string" },
      { key: "value", label: metric.name, type: "number", format: "currency", unit: config.currency },
    ],
    rows,
    meta: createMeta({
      config,
      dataSource,
      metric,
      previousValue: previous,
    }),
  };
}

async function createSub2ApiChannelBreakdownResult({ dataSource, metric }) {
  const config = assertConfigured();
  const summary = await getSub2ApiSummary();

  return {
    columns: [
      { key: "channel", label: "Channel", type: "string" },
      { key: "group_id", label: "Group ID", type: "number" },
      { key: "total_spend", label: "Total Spend", type: "number", format: "currency", unit: config.currency },
      { key: "earned_revenue", label: "Earned Revenue", type: "number", format: "currency", unit: config.currency },
      { key: "today_spend", label: "Today Spend", type: "number", format: "currency", unit: config.currency },
      { key: "today_earned", label: "Today Earned", type: "number", format: "currency", unit: config.currency },
      { key: "requests", label: "Requests", type: "number" },
      { key: "profit_rate", label: "Profit Rate", type: "number", format: "percent" },
    ],
    rows: summary.channels.map((channel) => ({
      channel: channel.name,
      group_id: channel.id ?? 0,
      total_spend: channel.totalCost,
      earned_revenue: channel.totalProfit,
      today_spend: channel.todayCost,
      today_earned: channel.todayProfit,
      requests: channel.requestCount,
      profit_rate: config.profitRate,
    })),
    meta: createMeta({
      config,
      dataSource,
      metric,
      previousValue: summary.totalProfit,
    }),
  };
}

async function createProfitTrendRows({ timeRange }) {
  const config = assertConfigured();
  const { startDate, endDate } = getRangeDates(timeRange, config);
  const channels = await getChannelStats({ startDate, endDate });
  const rows = [];
  const totals = new Map();

  for (const channel of channels) {
    if (!channel.id) {
      continue;
    }

    const data = await callSub2Api("/api/v1/admin/dashboard/trend", {
      start_date: startDate,
      end_date: endDate,
      granularity: "day",
      group_id: channel.id,
      timezone: config.timezone,
    });
    const trend = Array.isArray(data?.trend) ? data.trend : [];

    for (const point of trend) {
      const timestamp = dateStringToChartSeconds(point.date);
      const value = roundMoney(Number(point.actual_cost ?? point.cost ?? 0) * config.profitRate);
      rows.push({
        timestamp,
        series: channel.name,
        value,
      });
      totals.set(timestamp, roundMoney((totals.get(timestamp) ?? 0) + value));
    }
  }

  const totalRows = Array.from(totals.entries())
    .sort(([left], [right]) => left - right)
    .map(([timestamp, value]) => ({
      timestamp,
      series: "Total",
      value: roundMoney(value),
    }));

  return [...rows, ...totalRows].sort((left, right) => left.timestamp - right.timestamp || String(left.series).localeCompare(String(right.series)));
}

async function getChannelStats({ startDate, endDate, force = false }) {
  const config = assertConfigured();
  const data = await callSub2Api(
    "/api/v1/admin/dashboard/groups",
    {
      start_date: startDate,
      end_date: endDate,
      timezone: config.timezone,
    },
    { force },
  );
  const groups = Array.isArray(data?.groups) ? data.groups : [];

  return config.channels.map((channelName) => {
    const group = groups.find((item) => normalizeKey(item.group_name) === normalizeKey(channelName));
    return {
      id: group?.group_id ?? null,
      name: String(group?.group_name || channelName),
      actualCost: Number(group?.actual_cost ?? group?.cost ?? 0),
      requests: Number(group?.requests ?? 0),
      tokens: Number(group?.total_tokens ?? group?.tokens ?? 0),
    };
  });
}

async function callSub2Api(pathname, query = {}, { force = false } = {}) {
  const config = assertConfigured();
  const url = new URL(pathname, config.baseUrl);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  const cacheKey = url.toString();
  const cached = responseCache.get(cacheKey);
  if (!force && cached && Date.now() - cached.fetchedAt < config.cacheTtlMs) {
    return cached.data;
  }

  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      "x-api-key": config.adminApiKey,
    },
  });
  const text = await response.text();
  let payload;

  try {
    payload = JSON.parse(text);
  } catch {
    payload = { message: text.slice(0, 200) };
  }

  if (!response.ok || payload?.code) {
    const message = payload?.message || `Sub2API request failed with ${response.status}`;
    connectorState.lastErrorAt = new Date().toISOString();
    connectorState.lastError = message;
    const error = new Error(message);
    error.status = response.status || 502;
    throw error;
  }

  const data = payload?.data ?? payload;
  responseCache.set(cacheKey, {
    fetchedAt: Date.now(),
    data,
  });
  trimCache();
  connectorState.lastFetchedAt = new Date().toISOString();
  connectorState.lastError = null;
  return data;
}

function assertConfigured() {
  const config = getSub2ApiConfig();
  if (!config.configured) {
    const error = new Error("Sub2API admin API key is not configured");
    error.status = 503;
    throw error;
  }
  return config;
}

function createMeta({ config, dataSource, metric, previousValue }) {
  return {
    metric: { ...metric, unit: metric.format === "currency" ? config.currency : metric.unit },
    dataSource,
    unit: metric.format === "currency" ? config.currency : metric.unit,
    freshness: "live",
    generatedAt: new Date().toISOString(),
    previousValue,
  };
}

function getRangeDates(timeRange, config) {
  const today = getDateInTimezone(new Date(), config.timezone);
  const days = {
    "1h": 1,
    "1d": 7,
    "1w": 7,
    "1m": 30,
  }[timeRange];

  return {
    startDate: days ? addDays(today, -(days - 1)) : config.startDate,
    endDate: today,
  };
}

function getDateInTimezone(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function addDays(dateString, days) {
  const [year, month, day] = dateString.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

function dateStringToChartSeconds(dateString) {
  const [year, month, day] = String(dateString).split("-").map(Number);
  return Math.floor(Date.UTC(year, month - 1, day, 0, 0, 0) / 1000);
}

function normalizeKey(value) {
  return String(value || "").trim().toLowerCase();
}

function sum(items, key) {
  return items.reduce((total, item) => total + Number(item[key] ?? 0), 0);
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function roundPercent(value) {
  return `${Math.round(Number(value) * 10_000) / 100}%`;
}

function readNumberEnv(key, fallback) {
  const value = Number(process.env[key]);
  return Number.isFinite(value) ? value : fallback;
}

function readIntegerEnv(key, fallback) {
  const value = Number.parseInt(process.env[key] ?? "", 10);
  return Number.isFinite(value) ? value : fallback;
}

function trimCache() {
  while (responseCache.size > 200) {
    const oldestKey = responseCache.keys().next().value;
    if (!oldestKey) {
      return;
    }
    responseCache.delete(oldestKey);
  }
}
