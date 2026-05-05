import { createHash } from "node:crypto";
import { pool } from "./database.js";

const DEFAULT_BASE_URL = "https://nl2pcb.fugue.pro";
const DEFAULT_SYNC_LIMIT = 200;
const DEFAULT_SYNC_INTERVAL_MS = 5 * 60 * 1000;

const schedulerState = {
  enabled: false,
  intervalMs: 0,
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

export function getNl2PcbConfig() {
  const baseUrl = (process.env.NL2PCB_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const adminKey = process.env.NL2PCB_ADMIN_KEY?.trim();
  const syncLimit = readIntegerEnv("NL2PCB_SYNC_LIMIT", DEFAULT_SYNC_LIMIT);

  return {
    baseUrl,
    adminKey,
    syncLimit,
    configured: Boolean(adminKey),
  };
}

export async function getNl2PcbStatus() {
  const config = getNl2PcbConfig();
  const [snapshotResult, userResult, jobResult, feedbackResult] = await Promise.all([
    pool.query("select captured_at from nl2pcb_snapshots order by captured_at desc limit 1"),
    pool.query(`
      select
        count(*)::int as user_count,
        count(*) filter (where disabled is false)::int as active_user_count,
        count(*) filter (where disabled is true)::int as disabled_user_count,
        max(source_created_at) as last_user_at
      from nl2pcb_users
    `),
    pool.query(`
      select
        count(*)::int as job_count,
        count(*) filter (where source_created_at >= date_trunc('day', now()))::int as today_job_count,
        max(coalesce(source_updated_at, source_created_at, updated_at)) as last_job_at
      from nl2pcb_jobs
    `),
    pool.query(`
      select
        count(*)::int as feedback_count,
        max(source_created_at) as last_feedback_at
      from nl2pcb_feedback
    `),
  ]);

  const users = userResult.rows[0] ?? {};
  const jobs = jobResult.rows[0] ?? {};
  const feedback = feedbackResult.rows[0] ?? {};

  return {
    configured: config.configured,
    baseUrl: config.baseUrl,
    syncLimit: config.syncLimit,
    lastSnapshotAt: snapshotResult.rows[0]?.captured_at ?? null,
    userCount: Number(users.user_count ?? 0),
    activeUserCount: Number(users.active_user_count ?? 0),
    disabledUserCount: Number(users.disabled_user_count ?? 0),
    jobCount: Number(jobs.job_count ?? 0),
    todayJobCount: Number(jobs.today_job_count ?? 0),
    feedbackCount: Number(feedback.feedback_count ?? 0),
    lastUserAt: users.last_user_at ?? null,
    lastJobAt: jobs.last_job_at ?? null,
    lastFeedbackAt: feedback.last_feedback_at ?? null,
    scheduler: getNl2PcbSchedulerStatus(),
  };
}

export function startNl2PcbScheduler() {
  if (schedulerState.timer || schedulerState.initialTimer) {
    return getNl2PcbSchedulerStatus();
  }

  const enabled = readBooleanEnv("NL2PCB_SYNC_ENABLED", false);
  const intervalMs = readIntegerEnv("NL2PCB_SYNC_INTERVAL_MS", DEFAULT_SYNC_INTERVAL_MS);

  schedulerState.enabled = enabled && intervalMs > 0;
  schedulerState.intervalMs = intervalMs;
  schedulerState.limit = readIntegerEnv("NL2PCB_SYNC_LIMIT", DEFAULT_SYNC_LIMIT);

  if (!schedulerState.enabled) {
    return getNl2PcbSchedulerStatus();
  }

  const run = () => {
    runScheduledNl2PcbSync().catch((error) => {
      schedulerState.lastErrorAt = new Date().toISOString();
      schedulerState.lastError = error.message ?? "Scheduled NL2PCB sync failed";
      console.warn("[nl2pcb] scheduled sync failed", schedulerState.lastError);
    });
  };

  const initialDelayMs = readIntegerEnv("NL2PCB_SYNC_INITIAL_DELAY_MS", 10_000);
  schedulerState.nextRunAt = new Date(Date.now() + Math.max(initialDelayMs, 0)).toISOString();
  schedulerState.initialTimer = setTimeout(() => {
    schedulerState.initialTimer = null;
    run();
  }, Math.max(initialDelayMs, 0));
  schedulerState.initialTimer.unref?.();

  schedulerState.timer = setInterval(run, schedulerState.intervalMs);
  schedulerState.timer.unref?.();

  console.log(`[nl2pcb] scheduled sync enabled interval=${schedulerState.intervalMs}ms limit=${schedulerState.limit}`);

  return getNl2PcbSchedulerStatus();
}

export function getNl2PcbSchedulerStatus() {
  return {
    enabled: schedulerState.enabled,
    intervalMs: schedulerState.intervalMs,
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

export async function syncNl2Pcb({ limit = DEFAULT_SYNC_LIMIT } = {}) {
  assertConfigured();

  const safeLimit = Math.min(Math.max(Number(limit) || DEFAULT_SYNC_LIMIT, 1), 500);
  const [users, jobs, feedback] = await Promise.all([
    fetchAdminItems("/api/admin/users", { limit: safeLimit }),
    fetchAdminItems("/api/admin/jobs", { limit: safeLimit }),
    fetchAdminItems("/api/admin/feedback", { limit: safeLimit }),
  ]);

  const client = await pool.connect();
  try {
    await client.query("begin");

    for (const user of users) {
      await upsertNl2PcbUser(client, user);
    }
    for (const job of jobs) {
      await upsertNl2PcbJob(client, job);
    }
    for (const item of feedback) {
      await upsertNl2PcbFeedback(client, item);
    }

    const snapshot = await insertNl2PcbSnapshot(client, { users, jobs, feedback, limit: safeLimit });
    await client.query("commit");

    return {
      ok: true,
      syncedUsers: users.length,
      syncedJobs: jobs.length,
      syncedFeedback: feedback.length,
      snapshot,
    };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function listNl2PcbUsers({ limit = 100 } = {}) {
  const result = await pool.query(
    `
      select id, email, disabled, source_created_at, last_login_at, updated_at
      from nl2pcb_users
      order by coalesce(source_created_at, updated_at) desc
      limit $1
    `,
    [safeLimit(limit)],
  );
  return result.rows;
}

export async function listNl2PcbJobs({ limit = 100 } = {}) {
  const result = await pool.query(
    `
      select id, status, title, user_id, source_created_at, source_updated_at, updated_at
      from nl2pcb_jobs
      order by coalesce(source_updated_at, source_created_at, updated_at) desc
      limit $1
    `,
    [safeLimit(limit)],
  );
  return result.rows;
}

export async function listNl2PcbFeedback({ limit = 100 } = {}) {
  const result = await pool.query(
    `
      select id, user_id, email, message, source_created_at, updated_at
      from nl2pcb_feedback
      order by coalesce(source_created_at, updated_at) desc
      limit $1
    `,
    [safeLimit(limit)],
  );
  return result.rows;
}

export async function queryNl2PcbMetric({ dataSource, metric, query }) {
  if (metric.key === "nl2pcb_activity_trend") {
    return createNl2PcbActivityTrendResult({ dataSource, metric, timeRange: query.timeRange });
  }

  if (metric.key === "nl2pcb_recent_activity") {
    return createNl2PcbRecentActivityResult({ dataSource, metric });
  }

  return createNl2PcbKpiResult({ dataSource, metric });
}

async function runScheduledNl2PcbSync() {
  if (schedulerState.running) {
    return;
  }

  schedulerState.running = true;
  schedulerState.lastStartedAt = new Date().toISOString();
  schedulerState.nextRunAt = new Date(Date.now() + schedulerState.intervalMs).toISOString();

  try {
    const result = await syncNl2Pcb({ limit: schedulerState.limit });
    schedulerState.lastResult = result;
    schedulerState.lastSuccessAt = new Date().toISOString();
    schedulerState.lastError = null;
  } catch (error) {
    schedulerState.lastErrorAt = new Date().toISOString();
    schedulerState.lastError = error.message ?? "Scheduled NL2PCB sync failed";
    throw error;
  } finally {
    schedulerState.lastFinishedAt = new Date().toISOString();
    schedulerState.running = false;
  }
}

async function createNl2PcbKpiResult({ dataSource, metric }) {
  const status = await getNl2PcbStatus();
  let value = 0;

  switch (metric.key) {
    case "nl2pcb_total_users":
      value = status.userCount;
      break;
    case "nl2pcb_active_users":
      value = status.activeUserCount;
      break;
    case "nl2pcb_total_jobs":
      value = status.jobCount;
      break;
    case "nl2pcb_feedback_count":
      value = status.feedbackCount;
      break;
    default:
      value = 0;
  }

  return {
    columns: [
      { key: "timestamp", label: "Time", type: "time" },
      { key: "value", label: metric.name, type: "number", format: metric.format, unit: metric.unit },
    ],
    rows: status.configured ? [{ timestamp: Math.floor(Date.now() / 1000), value }] : [],
    meta: createMeta({ dataSource, metric, previousValue: value }),
  };
}

async function createNl2PcbActivityTrendResult({ dataSource, metric, timeRange }) {
  const { start, stepSeconds } = getRangeWindow(timeRange);
  const [users, jobs, feedback] = await Promise.all([
    pool.query(
      `
        select source_created_at as event_at, count(*)::int as value
        from nl2pcb_users
        where source_created_at >= $1
        group by source_created_at
      `,
      [start.toISOString()],
    ),
    pool.query(
      `
        select coalesce(source_created_at, created_at) as event_at, count(*)::int as value
        from nl2pcb_jobs
        where coalesce(source_created_at, created_at) >= $1
        group by coalesce(source_created_at, created_at)
      `,
      [start.toISOString()],
    ),
    pool.query(
      `
        select coalesce(source_created_at, created_at) as event_at, count(*)::int as value
        from nl2pcb_feedback
        where coalesce(source_created_at, created_at) >= $1
        group by coalesce(source_created_at, created_at)
      `,
      [start.toISOString()],
    ),
  ]);

  const buckets = new Map();
  addCountRowsToBuckets({ rows: users.rows, seriesName: "Users", stepSeconds, buckets });
  addCountRowsToBuckets({ rows: jobs.rows, seriesName: "Jobs", stepSeconds, buckets });
  addCountRowsToBuckets({ rows: feedback.rows, seriesName: "Feedback", stepSeconds, buckets });

  const rows = Array.from(buckets.values())
    .sort((left, right) => left.timestamp - right.timestamp || left.series.localeCompare(right.series));
  const totalRows = rows.filter((row) => row.series === "Jobs");
  const latest = Number(totalRows.at(-1)?.value ?? 0);
  const previous = Number(totalRows.at(-2)?.value ?? latest);

  return {
    columns: [
      { key: "timestamp", label: "Time", type: "time" },
      { key: "series", label: "Series", type: "string" },
      { key: "value", label: metric.name, type: "number", format: "number" },
    ],
    rows,
    meta: createMeta({ dataSource, metric, previousValue: previous }),
  };
}

async function createNl2PcbRecentActivityResult({ dataSource, metric }) {
  const [users, jobs, feedback] = await Promise.all([
    pool.query(`
      select id, email as actor, disabled::text as status, 'User' as event_type, 'Account created' as title, source_created_at as event_at
      from nl2pcb_users
      order by coalesce(source_created_at, updated_at) desc
      limit 50
    `),
    pool.query(`
      select id, coalesce(user_id, '') as actor, coalesce(status, '') as status, 'Job' as event_type, title, coalesce(source_updated_at, source_created_at, updated_at) as event_at
      from nl2pcb_jobs
      order by coalesce(source_updated_at, source_created_at, updated_at) desc
      limit 50
    `),
    pool.query(`
      select id, coalesce(email, user_id, '') as actor, '' as status, 'Feedback' as event_type, left(message, 120) as title, coalesce(source_created_at, updated_at) as event_at
      from nl2pcb_feedback
      order by coalesce(source_created_at, updated_at) desc
      limit 50
    `),
  ]);

  const rows = [...users.rows, ...jobs.rows, ...feedback.rows]
    .filter((row) => row.event_at)
    .sort((left, right) => new Date(right.event_at).getTime() - new Date(left.event_at).getTime())
    .slice(0, 50)
    .map((row) => ({
      id: `${row.event_type}:${row.id}`,
      event_at: Math.floor(new Date(row.event_at).getTime() / 1000),
      event_type: row.event_type,
      title: row.title || row.id,
      actor: row.actor || "",
      status: row.event_type === "User" ? (row.status === "true" ? "disabled" : "active") : row.status || "",
    }));

  return {
    columns: [
      { key: "event_at", label: "Time", type: "time" },
      { key: "event_type", label: "Type", type: "string" },
      { key: "title", label: "Title", type: "string" },
      { key: "actor", label: "Actor", type: "string" },
      { key: "status", label: "Status", type: "string" },
    ],
    rows,
    meta: createMeta({ dataSource, metric, previousValue: rows.length }),
  };
}

async function fetchAdminItems(pathname, query = {}) {
  const payload = await callNl2Pcb(pathname, query);
  if (Array.isArray(payload)) {
    return payload;
  }
  if (Array.isArray(payload?.items)) {
    return payload.items;
  }
  return [];
}

async function callNl2Pcb(pathname, query = {}) {
  const config = assertConfigured();
  const url = new URL(pathname, config.baseUrl);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      authorization: `Bearer ${config.adminKey}`,
    },
  });
  const text = await response.text();
  let payload;

  try {
    payload = JSON.parse(text);
  } catch {
    payload = { message: text.slice(0, 200) };
  }

  if (!response.ok) {
    const message = payload?.message || payload?.error?.message || `NL2PCB request failed with ${response.status}`;
    const error = new Error(message);
    error.status = response.status || 502;
    throw error;
  }

  return payload?.data ?? payload;
}

async function upsertNl2PcbUser(client, item) {
  const id = pickId(item, "user");
  await client.query(
    `
      insert into nl2pcb_users (id, email, disabled, source_created_at, last_login_at, raw)
      values ($1, $2, $3, $4, $5, $6::jsonb)
      on conflict (id) do update
        set email = coalesce(excluded.email, nl2pcb_users.email),
            disabled = coalesce(excluded.disabled, nl2pcb_users.disabled),
            source_created_at = coalesce(excluded.source_created_at, nl2pcb_users.source_created_at),
            last_login_at = coalesce(excluded.last_login_at, nl2pcb_users.last_login_at),
            raw = excluded.raw,
            updated_at = now()
    `,
    [
      id,
      valueAsString(item.email),
      valueAsBoolean(item.disabled),
      parseTime(item.created_at ?? item.createdAt),
      parseTime(item.last_login_at ?? item.lastLoginAt),
      JSON.stringify(item),
    ],
  );
}

async function upsertNl2PcbJob(client, item) {
  const id = pickId(item, "job");
  await client.query(
    `
      insert into nl2pcb_jobs (id, status, title, user_id, source_created_at, source_updated_at, raw)
      values ($1, $2, $3, $4, $5, $6, $7::jsonb)
      on conflict (id) do update
        set status = coalesce(excluded.status, nl2pcb_jobs.status),
            title = coalesce(excluded.title, nl2pcb_jobs.title),
            user_id = coalesce(excluded.user_id, nl2pcb_jobs.user_id),
            source_created_at = coalesce(excluded.source_created_at, nl2pcb_jobs.source_created_at),
            source_updated_at = coalesce(excluded.source_updated_at, nl2pcb_jobs.source_updated_at),
            raw = excluded.raw,
            updated_at = now()
    `,
    [
      id,
      valueAsString(item.status ?? item.state),
      valueAsString(item.title ?? item.name ?? item.prompt ?? item.input),
      valueAsString(item.user_id ?? item.userId ?? item.user?.id),
      parseTime(item.created_at ?? item.createdAt),
      parseTime(item.updated_at ?? item.updatedAt ?? item.completed_at ?? item.completedAt),
      JSON.stringify(item),
    ],
  );
}

async function upsertNl2PcbFeedback(client, item) {
  const id = pickId(item, "feedback");
  await client.query(
    `
      insert into nl2pcb_feedback (id, user_id, email, message, source_created_at, raw)
      values ($1, $2, $3, $4, $5, $6::jsonb)
      on conflict (id) do update
        set user_id = coalesce(excluded.user_id, nl2pcb_feedback.user_id),
            email = coalesce(excluded.email, nl2pcb_feedback.email),
            message = coalesce(excluded.message, nl2pcb_feedback.message),
            source_created_at = coalesce(excluded.source_created_at, nl2pcb_feedback.source_created_at),
            raw = excluded.raw,
            updated_at = now()
    `,
    [
      id,
      valueAsString(item.user_id ?? item.userId ?? item.user?.id),
      valueAsString(item.email ?? item.user?.email),
      valueAsString(item.message ?? item.content ?? item.text),
      parseTime(item.created_at ?? item.createdAt ?? item.submitted_at ?? item.submittedAt),
      JSON.stringify(item),
    ],
  );
}

async function insertNl2PcbSnapshot(client, { users, jobs, feedback, limit }) {
  const result = await client.query(
    `
      insert into nl2pcb_snapshots (
        user_count, active_user_count, disabled_user_count, job_count, feedback_count, raw
      )
      values ($1, $2, $3, $4, $5, $6::jsonb)
      returning *
    `,
    [
      users.length,
      users.filter((item) => valueAsBoolean(item.disabled) === false).length,
      users.filter((item) => valueAsBoolean(item.disabled) === true).length,
      jobs.length,
      feedback.length,
      JSON.stringify({
        limit,
        userCount: users.length,
        jobCount: jobs.length,
        feedbackCount: feedback.length,
      }),
    ],
  );
  return result.rows[0];
}

function addCountRowsToBuckets({ rows, seriesName, stepSeconds, buckets }) {
  for (const row of rows) {
    if (!row.event_at) {
      continue;
    }
    const seconds = Math.floor(new Date(row.event_at).getTime() / 1000);
    const bucket = Math.floor(seconds / stepSeconds) * stepSeconds;
    const key = `${seriesName}:${bucket}`;
    buckets.set(key, {
      timestamp: bucket,
      series: seriesName,
      value: (buckets.get(key)?.value ?? 0) + Number(row.value ?? 0),
    });
  }
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

function assertConfigured() {
  const config = getNl2PcbConfig();
  if (!config.configured) {
    const error = new Error("NL2PCB admin key is not configured");
    error.status = 503;
    throw error;
  }
  return config;
}

function pickId(item, prefix) {
  const keys = {
    user: ["id", "uuid", "user_id", "userId"],
    job: ["id", "uuid", "job_id", "jobId"],
    feedback: ["id", "uuid", "feedback_id", "feedbackId"],
  }[prefix] ?? ["id", "uuid"];
  const explicit = keys.map((key) => item?.[key]).find(Boolean);
  if (explicit) {
    return String(explicit);
  }
  return `${prefix}_${createHash("sha256").update(JSON.stringify(item)).digest("hex").slice(0, 24)}`;
}

function parseTime(value) {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString();
}

function valueAsString(value) {
  if (value === undefined || value === null) {
    return null;
  }
  return String(value);
}

function valueAsBoolean(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (typeof value === "boolean") {
    return value;
  }
  return ["true", "1", "yes", "disabled"].includes(String(value).trim().toLowerCase());
}

function getRangeWindow(timeRange) {
  const now = Date.now();
  const config = {
    "1h": { durationMs: 24 * 60 * 60 * 1000, stepSeconds: 60 * 60 },
    "1d": { durationMs: 7 * 24 * 60 * 60 * 1000, stepSeconds: 24 * 60 * 60 },
    "1w": { durationMs: 7 * 24 * 60 * 60 * 1000, stepSeconds: 24 * 60 * 60 },
    "1m": { durationMs: 30 * 24 * 60 * 60 * 1000, stepSeconds: 24 * 60 * 60 },
    all: { durationMs: 365 * 24 * 60 * 60 * 1000, stepSeconds: 24 * 60 * 60 },
  }[timeRange] ?? { durationMs: 30 * 24 * 60 * 60 * 1000, stepSeconds: 24 * 60 * 60 };

  return {
    start: new Date(now - config.durationMs),
    stepSeconds: config.stepSeconds,
  };
}

function safeLimit(value) {
  return Math.min(Math.max(Number(value) || 100, 1), 500);
}

function readBooleanEnv(key, fallback) {
  const value = process.env[key];
  if (value === undefined) {
    return fallback;
  }
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function readIntegerEnv(key, fallback) {
  const value = Number.parseInt(process.env[key] ?? "", 10);
  return Number.isFinite(value) ? value : fallback;
}
