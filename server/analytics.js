import { randomUUID } from "node:crypto";
import { pool } from "./database.js";
import { getSecretPrefix, hashSecret } from "./security.js";

const DEFAULT_PROJECT_ID = process.env.DATAOCEAN_DEFAULT_PROJECT_ID?.trim() || "uni-api-web";
const DEFAULT_PROJECT_NAME = process.env.DATAOCEAN_DEFAULT_PROJECT_NAME?.trim() || "Uni API Web";
const DEFAULT_PUBLIC_KEY = process.env.DATAOCEAN_PUBLIC_WRITE_KEY?.trim() || "";
const DEFAULT_SERVER_KEY = process.env.DATAOCEAN_SERVER_KEY?.trim() || "";
const MAX_BATCH_SIZE = 100;

export async function ensureDefaultAnalyticsProject() {
  await pool.query(
    `
      insert into analytics_projects (id, name)
      values ($1, $2)
      on conflict (id) do update
        set name = excluded.name,
            updated_at = now()
    `,
    [DEFAULT_PROJECT_ID, DEFAULT_PROJECT_NAME],
  );

  await ensureProjectKey({
    projectId: DEFAULT_PROJECT_ID,
    scope: "public",
    key: DEFAULT_PUBLIC_KEY,
  });
  await ensureProjectKey({
    projectId: DEFAULT_PROJECT_ID,
    scope: "server",
    key: DEFAULT_SERVER_KEY,
  });
}

async function ensureProjectKey({ projectId, scope, key }) {
  const effectiveKey = key || (scope === "public" ? await createDefaultPublicAnalyticsKey(projectId) : "");
  if (!effectiveKey) {
    return;
  }

  await pool.query(
    `
      insert into analytics_project_keys (id, project_id, scope, key_hash, key_prefix, key_value)
      values ($1, $2, $3, $4, $5, $6)
      on conflict (key_hash) do update
        set project_id = excluded.project_id,
            scope = excluded.scope,
            key_prefix = excluded.key_prefix,
            key_value = coalesce(analytics_project_keys.key_value, excluded.key_value)
    `,
    [
      randomUUID(),
      projectId,
      scope,
      hashSecret(effectiveKey),
      getSecretPrefix(effectiveKey),
      scope === "public" ? effectiveKey : null,
    ],
  );
}

async function createDefaultPublicAnalyticsKey(projectId) {
  const existing = await pool.query(
    `
      select key_value
      from analytics_project_keys
      where project_id = $1 and scope = 'public' and key_value is not null
      order by created_at asc
      limit 1
    `,
    [projectId],
  );
  const key = existing.rows[0]?.key_value;
  if (typeof key === "string" && key.trim()) {
    return key.trim();
  }

  return `do_public_${projectId.replace(/[^a-zA-Z0-9_-]/g, "_")}_${randomUUID().replaceAll("-", "")}`;
}

export function readCollectSecret(req) {
  const headerKey = req.get("x-dataocean-key")?.trim();
  if (headerKey) {
    return headerKey;
  }

  const authorization = req.get("authorization") ?? "";
  const bearer = authorization.match(/^bearer\s+(.+)$/i)?.[1]?.trim();
  if (bearer) {
    return bearer;
  }

  const queryKey = typeof req.query?.writeKey === "string" ? req.query.writeKey.trim() : "";
  if (queryKey) {
    return queryKey;
  }

  const body = req.body;
  if (body && typeof body === "object" && !Array.isArray(body)) {
    const raw = body.writeKey ?? body.serverKey ?? body.key;
    if (typeof raw === "string" && raw.trim()) {
      return raw.trim();
    }
  }

  return "";
}

export async function findCollectProjectBySecret(secret, { allowedScopes = ["public", "server"] } = {}) {
  if (!secret) {
    return null;
  }

  const result = await pool.query(
    `
      select
        p.id as project_id,
        p.name as project_name,
        k.id as key_id,
        k.scope
      from analytics_project_keys k
      join analytics_projects p on p.id = k.project_id
      where k.key_hash = $1
      limit 1
    `,
    [hashSecret(secret)],
  );
  const row = result.rows[0];
  if (!row || !allowedScopes.includes(row.scope)) {
    return null;
  }

  await pool.query("update analytics_project_keys set last_used_at = now() where id = $1", [row.key_id]);
  return {
    id: row.project_id,
    name: row.project_name,
    keyId: row.key_id,
    scope: row.scope,
  };
}

export async function isOriginAllowed(projectId, origin) {
  const result = await pool.query(
    "select origin from analytics_project_origins where project_id = $1",
    [projectId],
  );
  if (result.rowCount === 0 || !origin) {
    return true;
  }

  const normalized = normalizeOrigin(origin);
  if (!normalized) {
    return false;
  }

  return result.rows.some((row) => originMatches(String(row.origin ?? ""), normalized));
}

export async function collectPayload({ project, payload, req }) {
  const events = normalizePayloadEvents(payload);
  if (events.length === 0) {
    const error = new Error("No events provided");
    error.status = 400;
    throw error;
  }
  if (events.length > MAX_BATCH_SIZE) {
    const error = new Error(`Too many events; max ${MAX_BATCH_SIZE}`);
    error.status = 413;
    throw error;
  }

  const receivedAt = new Date();
  let accepted = 0;
  const insertedEventIds = [];

  for (const rawEvent of events) {
    const normalized = normalizeEvent(rawEvent, { project, req, receivedAt });
    const inserted = await insertEvent(project.id, normalized);
    if (inserted) {
      accepted += 1;
      insertedEventIds.push(normalized.eventId);
      await updateIdentity(project.id, normalized);
      await updateAttribution(project.id, normalized);
    }
  }

  return {
    ok: true,
    accepted,
    duplicate: events.length - accepted,
    eventIds: insertedEventIds,
    projectId: project.id,
  };
}

export async function getAnalyticsStatus() {
  const projects = await pool.query(
    `
      select
        p.id,
        p.name,
        p.created_at,
        p.updated_at,
        count(e.id)::int as event_count,
        max(e.received_at) as last_event_at
      from analytics_projects p
      left join analytics_events e on e.project_id = p.id
      group by p.id, p.name, p.created_at, p.updated_at
      order by p.created_at asc
    `,
  );

  const keys = await pool.query(
    `
      select project_id, scope, key_prefix, key_value, last_used_at
      from analytics_project_keys
      order by project_id asc, scope asc
    `,
  );

  return {
    defaultProjectId: DEFAULT_PROJECT_ID,
    projects: projects.rows.map((row) => ({
      id: row.id,
      name: row.name,
      eventCount: Number(row.event_count ?? 0),
      lastEventAt: toIso(row.last_event_at),
      createdAt: toIso(row.created_at),
      updatedAt: toIso(row.updated_at),
        keys: keys.rows
        .filter((key) => key.project_id === row.id)
        .map((key) => ({
          scope: key.scope,
          prefix: key.key_prefix,
          lastUsedAt: toIso(key.last_used_at),
        })),
    })),
  };
}

export async function getAnalyticsClientConfig({ project }) {
  await ensureProjectKey({ projectId: project.id, scope: "public", key: "" });
  const result = await pool.query(
    `
      select key_value, key_prefix
      from analytics_project_keys
      where project_id = $1 and scope = 'public' and key_value is not null
      order by created_at asc
      limit 1
    `,
    [project.id],
  );
  const row = result.rows[0];
  return {
    projectId: project.id,
    projectName: project.name,
    publicWriteKey: row?.key_value ?? null,
    publicWriteKeyPrefix: row?.key_prefix ?? null,
  };
}

export async function getAcquisitionSummary({ projectId = DEFAULT_PROJECT_ID, from, to, limit = 12 }) {
  const safeLimit = coerceLimit(limit);
  const range = normalizeRange({ from, to });
  const project = await getProject(projectId);
  if (!project) {
    const error = new Error("Unknown analytics project");
    error.status = 404;
    throw error;
  }

  const kpisResult = await pool.query(
    `
      select
        count(*) filter (where name = 'landing_view')::int as landing_views,
        count(*) filter (where name = 'signup_started')::int as signup_started,
        count(*) filter (where name = 'signup_completed')::int as signup_events,
        count(distinct nullif(anonymous_id, '')) filter (where name in ('page_view', 'landing_view'))::int as visitors,
        count(distinct nullif(session_id, '')) filter (where name in ('page_view', 'landing_view'))::int as sessions
      from analytics_events
      where project_id = $1 and occurred_at >= $2 and occurred_at <= $3
    `,
    [project.id, range.from, range.to],
  );
  const attributionResult = await pool.query(
    `
      select count(*)::int as attributed_signups
      from analytics_attributions
      where project_id = $1 and signup_at >= $2 and signup_at <= $3
    `,
    [project.id, range.from, range.to],
  );
  const kpiRow = kpisResult.rows[0] ?? {};
  const attributedSignups = Number(attributionResult.rows[0]?.attributed_signups ?? 0);
  const signupEvents = Number(kpiRow.signup_events ?? 0);
  const signups = Math.max(attributedSignups, signupEvents);
  const landingViews = Number(kpiRow.landing_views ?? 0);

  const sourcesResult = await pool.query(
    `
      with landing as (
        select source_key(source, referrer_host) as source_key, count(*)::int as landing_views
        from analytics_events
        where project_id = $1 and name = 'landing_view' and occurred_at >= $2 and occurred_at <= $3
        group by source_key(source, referrer_host)
      ),
      starts as (
        select source_key(source, referrer_host) as source_key, count(*)::int as signup_started
        from analytics_events
        where project_id = $1 and name = 'signup_started' and occurred_at >= $2 and occurred_at <= $3
        group by source_key(source, referrer_host)
      ),
      signups as (
        select source_key(first_source, first_referrer_host) as source_key, count(*)::int as signups
        from analytics_attributions
        where project_id = $1 and signup_at >= $2 and signup_at <= $3
        group by source_key(first_source, first_referrer_host)
      ),
      keys as (
        select source_key from landing
        union select source_key from starts
        union select source_key from signups
      )
      select
        keys.source_key,
        coalesce(landing.landing_views, 0)::int as landing_views,
        coalesce(starts.signup_started, 0)::int as signup_started,
        coalesce(signups.signups, 0)::int as signups
      from keys
      left join landing on landing.source_key = keys.source_key
      left join starts on starts.source_key = keys.source_key
      left join signups on signups.source_key = keys.source_key
      order by signups desc, landing_views desc, keys.source_key asc
      limit $4
    `,
    [project.id, range.from, range.to, safeLimit],
  );

  const seriesResult = await pool.query(
    `
      with event_series as (
        select
          date_trunc('day', occurred_at) as bucket,
          count(*) filter (where name = 'landing_view')::int as landing_views,
          count(*) filter (where name = 'signup_started')::int as signup_started,
          count(*) filter (where name = 'signup_completed')::int as signup_events
        from analytics_events
        where project_id = $1 and occurred_at >= $2 and occurred_at <= $3
        group by date_trunc('day', occurred_at)
      ),
      attribution_series as (
        select date_trunc('day', signup_at) as bucket, count(*)::int as attributed_signups
        from analytics_attributions
        where project_id = $1 and signup_at >= $2 and signup_at <= $3
        group by date_trunc('day', signup_at)
      ),
      buckets as (
        select bucket from event_series
        union select bucket from attribution_series
      )
      select
        buckets.bucket,
        coalesce(event_series.landing_views, 0)::int as landing_views,
        coalesce(event_series.signup_started, 0)::int as signup_started,
        greatest(coalesce(event_series.signup_events, 0), coalesce(attribution_series.attributed_signups, 0))::int as signups
      from buckets
      left join event_series on event_series.bucket = buckets.bucket
      left join attribution_series on attribution_series.bucket = buckets.bucket
      order by buckets.bucket asc
    `,
    [project.id, range.from, range.to],
  );

  const recentEvents = await pool.query(
    `
      select event_id, name, anonymous_id, user_id, path, source, referrer_host, occurred_at, received_at
      from analytics_events
      where project_id = $1
      order by received_at desc
      limit 20
    `,
    [project.id],
  );

  return {
    project: { id: project.id, name: project.name },
    range: {
      from: range.from.toISOString(),
      to: range.to.toISOString(),
    },
    kpis: {
      visitors: Number(kpiRow.visitors ?? 0),
      sessions: Number(kpiRow.sessions ?? 0),
      landingViews,
      signupStarted: Number(kpiRow.signup_started ?? 0),
      signups,
      conversionRate: landingViews > 0 ? signups / landingViews : null,
    },
    sources: sourcesResult.rows.map((row) => ({
      source: row.source_key,
      landingViews: Number(row.landing_views ?? 0),
      signupStarted: Number(row.signup_started ?? 0),
      signups: Number(row.signups ?? 0),
      conversionRate: Number(row.landing_views ?? 0) > 0 ? Number(row.signups ?? 0) / Number(row.landing_views ?? 0) : null,
    })),
    series: seriesResult.rows.map((row) => ({
      ts: toIso(row.bucket),
      landingViews: Number(row.landing_views ?? 0),
      signupStarted: Number(row.signup_started ?? 0),
      signups: Number(row.signups ?? 0),
    })),
    recentEvents: recentEvents.rows.map((row) => ({
      eventId: row.event_id,
      name: row.name,
      anonymousId: row.anonymous_id,
      userId: row.user_id,
      path: row.path,
      source: sourceKey(row.source, row.referrer_host),
      occurredAt: toIso(row.occurred_at),
      receivedAt: toIso(row.received_at),
    })),
  };
}

async function getProject(projectId) {
  const result = await pool.query("select id, name from analytics_projects where id = $1", [projectId]);
  return result.rows[0] ?? null;
}

async function insertEvent(projectId, event) {
  const result = await pool.query(
    `
      insert into analytics_events (
        id, project_id, event_id, name, anonymous_id, session_id, user_id,
        occurred_at, received_at, url, path, title, referrer, referrer_host,
        source, medium, campaign, content, term, properties, context, raw
      )
      values (
        $1, $2, $3, $4, $5, $6, $7,
        $8, $9, $10, $11, $12, $13, $14,
        $15, $16, $17, $18, $19, $20::jsonb, $21::jsonb, $22::jsonb
      )
      on conflict (project_id, event_id) do nothing
      returning id
    `,
    [
      randomUUID(),
      projectId,
      event.eventId,
      event.name,
      event.anonymousId,
      event.sessionId,
      event.userId,
      event.occurredAt.toISOString(),
      event.receivedAt.toISOString(),
      event.url,
      event.path,
      event.title,
      event.referrer,
      event.referrerHost,
      event.source,
      event.medium,
      event.campaign,
      event.content,
      event.term,
      JSON.stringify(event.properties),
      JSON.stringify(event.context),
      JSON.stringify(event.raw),
    ],
  );

  return result.rowCount > 0;
}

async function updateIdentity(projectId, event) {
  if (!event.anonymousId || !event.userId) {
    return;
  }

  await pool.query(
    `
      insert into analytics_identities (id, project_id, anonymous_id, user_id, first_seen_at, last_seen_at)
      values ($1, $2, $3, $4, $5, $5)
      on conflict (project_id, anonymous_id, user_id) do update
        set last_seen_at = greatest(analytics_identities.last_seen_at, excluded.last_seen_at)
    `,
    [randomUUID(), projectId, event.anonymousId, event.userId, event.occurredAt.toISOString()],
  );
}

async function updateAttribution(projectId, event) {
  if (event.name !== "signup_completed" || !event.userId) {
    return;
  }

  const firstTouch = await findTouchEvent(projectId, event, "asc");
  const lastTouch = await findTouchEvent(projectId, event, "desc");
  const first = firstTouch ?? touchFromEvent(event);
  const last = lastTouch ?? first;

  await pool.query(
    `
      insert into analytics_attributions (
        id, project_id, user_id, anonymous_id, signup_event_id, signup_at,
        first_source, first_medium, first_campaign, first_referrer_host, first_landing_path,
        last_source, last_medium, last_campaign, last_referrer_host, last_landing_path
      )
      values (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9, $10, $11,
        $12, $13, $14, $15, $16
      )
      on conflict (project_id, user_id) do update
        set anonymous_id = coalesce(excluded.anonymous_id, analytics_attributions.anonymous_id),
            signup_event_id = excluded.signup_event_id,
            signup_at = excluded.signup_at,
            first_source = coalesce(analytics_attributions.first_source, excluded.first_source),
            first_medium = coalesce(analytics_attributions.first_medium, excluded.first_medium),
            first_campaign = coalesce(analytics_attributions.first_campaign, excluded.first_campaign),
            first_referrer_host = coalesce(analytics_attributions.first_referrer_host, excluded.first_referrer_host),
            first_landing_path = coalesce(analytics_attributions.first_landing_path, excluded.first_landing_path),
            last_source = excluded.last_source,
            last_medium = excluded.last_medium,
            last_campaign = excluded.last_campaign,
            last_referrer_host = excluded.last_referrer_host,
            last_landing_path = excluded.last_landing_path,
            updated_at = now()
    `,
    [
      randomUUID(),
      projectId,
      event.userId,
      event.anonymousId,
      event.eventId,
      event.occurredAt.toISOString(),
      first.source,
      first.medium,
      first.campaign,
      first.referrerHost,
      first.path,
      last.source,
      last.medium,
      last.campaign,
      last.referrerHost,
      last.path,
    ],
  );
}

async function findTouchEvent(projectId, event, direction) {
  const clauses = ["project_id = $1", "occurred_at <= $2", "name in ('landing_view', 'page_view', 'signup_started')"];
  const params = [projectId, event.occurredAt.toISOString()];

  if (event.anonymousId) {
    params.push(event.anonymousId);
    clauses.push(`anonymous_id = $${params.length}`);
  } else if (event.userId) {
    params.push(event.userId);
    clauses.push(`user_id = $${params.length}`);
  } else {
    return null;
  }

  const result = await pool.query(
    `
      select source, medium, campaign, referrer_host, path
      from analytics_events
      where ${clauses.join(" and ")}
      order by occurred_at ${direction === "asc" ? "asc" : "desc"}
      limit 1
    `,
    params,
  );
  const row = result.rows[0];
  if (!row) {
    return null;
  }
  return {
    source: sourceKey(row.source, row.referrer_host),
    medium: cleanString(row.medium) ?? (row.referrer_host ? "referral" : "direct"),
    campaign: cleanString(row.campaign),
    referrerHost: cleanString(row.referrer_host),
    path: cleanString(row.path),
  };
}

function normalizePayloadEvents(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (!payload || typeof payload !== "object") {
    return [];
  }
  if (Array.isArray(payload.events)) {
    return payload.events;
  }
  if (payload.event && typeof payload.event === "object") {
    return [payload.event];
  }
  return [payload];
}

function normalizeEvent(rawEvent, { project, req, receivedAt }) {
  const raw = rawEvent && typeof rawEvent === "object" && !Array.isArray(rawEvent) ? { ...rawEvent } : {};
  delete raw.writeKey;
  delete raw.serverKey;
  delete raw.key;
  const properties = isPlainObject(raw.properties) ? raw.properties : {};
  const context = {
    ...(isPlainObject(raw.context) ? raw.context : {}),
    ip: req.ip,
    userAgent: req.get("user-agent") ?? null,
    origin: req.get("origin") ?? null,
  };
  const rawUtm = isPlainObject(raw.utm) ? raw.utm : isPlainObject(context.utm) ? context.utm : {};
  const eventName = cleanString(raw.name) ?? cleanString(raw.event) ?? cleanString(raw.type) ?? "event";
  const url = cleanString(raw.url) ?? cleanString(context.url);
  const path = cleanString(raw.path) ?? cleanString(context.path) ?? pathFromUrl(url);
  const referrer = cleanString(raw.referrer) ?? cleanString(context.referrer);
  const referrerHost = normalizeHost(referrer);
  const source = cleanString(raw.source) ?? cleanString(rawUtm.source) ?? cleanString(rawUtm.utm_source) ?? sourceKey(null, referrerHost);
  const medium = cleanString(raw.medium) ?? cleanString(rawUtm.medium) ?? cleanString(rawUtm.utm_medium) ?? (referrerHost ? "referral" : "direct");

  return {
    raw,
    eventId: cleanString(raw.eventId) ?? cleanString(raw.event_id) ?? randomUUID(),
    name: eventName.slice(0, 96),
    anonymousId: cleanString(raw.anonymousId) ?? cleanString(raw.anonymous_id) ?? cleanString(context.anonymousId),
    sessionId: cleanString(raw.sessionId) ?? cleanString(raw.session_id) ?? cleanString(context.sessionId),
    userId: cleanString(raw.userId) ?? cleanString(raw.user_id) ?? cleanString(context.userId),
    occurredAt: parseDate(raw.timestamp ?? raw.occurredAt ?? raw.createdAt) ?? receivedAt,
    receivedAt,
    url,
    path,
    title: cleanString(raw.title) ?? cleanString(context.title),
    referrer,
    referrerHost,
    source,
    medium,
    campaign: cleanString(raw.campaign) ?? cleanString(rawUtm.campaign) ?? cleanString(rawUtm.utm_campaign),
    content: cleanString(raw.content) ?? cleanString(rawUtm.content) ?? cleanString(rawUtm.utm_content),
    term: cleanString(raw.term) ?? cleanString(rawUtm.term) ?? cleanString(rawUtm.utm_term),
    properties,
    context: { ...context, projectId: project.id },
  };
}

function touchFromEvent(event) {
  return {
    source: sourceKey(event.source, event.referrerHost),
    medium: event.medium,
    campaign: event.campaign,
    referrerHost: event.referrerHost,
    path: event.path,
  };
}

function normalizeRange({ from, to }) {
  const now = new Date();
  const fallbackFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const parsedFrom = parseDate(from) ?? fallbackFrom;
  const parsedTo = parseDate(to) ?? now;
  return parsedFrom <= parsedTo
    ? { from: parsedFrom, to: parsedTo }
    : { from: parsedTo, to: parsedFrom };
}

function parseDate(value) {
  if (!value) {
    return null;
  }
  const parsed = new Date(String(value));
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function coerceLimit(value) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) {
    return 12;
  }
  return Math.min(Math.max(parsed, 1), 100);
}

function sourceKey(source, referrerHost) {
  const cleanSource = cleanString(source);
  if (cleanSource) {
    return cleanSource;
  }
  const cleanHost = cleanString(referrerHost);
  return cleanHost || "direct";
}

function normalizeOrigin(value) {
  try {
    const url = new URL(String(value));
    return url.origin.toLowerCase();
  } catch {
    return "";
  }
}

function originMatches(rule, origin) {
  const normalizedRule = rule.trim().toLowerCase();
  if (!normalizedRule || normalizedRule === "*") {
    return true;
  }
  if (normalizedRule.startsWith("*.")) {
    const suffix = normalizedRule.slice(1);
    return origin.endsWith(suffix);
  }
  return normalizedRule === origin;
}

function normalizeHost(value) {
  const raw = cleanString(value);
  if (!raw) {
    return null;
  }
  try {
    return new URL(raw).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

function pathFromUrl(value) {
  const raw = cleanString(value);
  if (!raw) {
    return null;
  }
  try {
    const url = new URL(raw);
    return `${url.pathname}${url.search}`.slice(0, 1024);
  } catch {
    return null;
  }
}

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function cleanString(value) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 2048) : null;
}

function toIso(value) {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
