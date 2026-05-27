import pg from "pg";
import { randomUUID } from "node:crypto";
import { defaultAppState } from "./defaultState.js";
import { getSecretPrefix, hashSecret } from "./security.js";

const { Pool } = pg;

function createConnectionString() {
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }

  if (process.env.DB_HOST) {
    const user = encodeURIComponent(process.env.DB_USER ?? "dataocean");
    const password = encodeURIComponent(process.env.DB_PASSWORD ?? "");
    const host = process.env.DB_HOST;
    const port = process.env.DB_PORT ?? "5432";
    const database = encodeURIComponent(process.env.DB_NAME ?? "dataocean");
    return `postgres://${user}:${password}@${host}:${port}/${database}`;
  }

  return "postgres://dataocean:dataocean@localhost:5432/dataocean";
}

const connectionString = createConnectionString();
const DEFAULT_ANALYTICS_PROJECT_ID = process.env.DATAOCEAN_DEFAULT_PROJECT_ID?.trim() || "uni-api-web";
const DEFAULT_ANALYTICS_PROJECT_NAME = process.env.DATAOCEAN_DEFAULT_PROJECT_NAME?.trim() || "Uni API Web";
const DEFAULT_ANALYTICS_PUBLIC_KEY = process.env.DATAOCEAN_PUBLIC_WRITE_KEY?.trim() || "";
const DEFAULT_ANALYTICS_SERVER_KEY = process.env.DATAOCEAN_SERVER_KEY?.trim() || "";

export const pool = new Pool({
  connectionString,
  connectionTimeoutMillis: Number(process.env.PG_CONNECT_TIMEOUT_MS ?? 5000),
  max: Number(process.env.PG_POOL_SIZE ?? 10),
  ssl: process.env.PGSSLMODE === "require" ? { rejectUnauthorized: false } : undefined,
});

export async function waitForDatabase({ retries = 30, delayMs = 1000 } = {}) {
  let lastError;

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      await pool.query("select 1");
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw lastError;
}

export async function migrateDatabase() {
  await pool.query(`
    create table if not exists users (
      id uuid primary key,
      email text not null unique,
      name text not null,
      password_hash text not null,
      role text not null check (role in ('admin', 'member')),
      api_key_hash text not null unique,
      api_key_prefix text not null,
      api_key_scope text not null check (api_key_scope in ('admin', 'user')),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create table if not exists sessions (
      token_hash text primary key,
      user_id uuid not null references users(id) on delete cascade,
      expires_at timestamptz not null,
      created_at timestamptz not null default now()
    );

    create table if not exists app_state (
      key text primary key,
      value jsonb not null,
      updated_at timestamptz not null default now(),
      updated_by uuid references users(id) on delete set null
    );

    create table if not exists audit_logs (
      id bigserial primary key,
      user_id uuid references users(id) on delete set null,
      action text not null,
      resource_type text not null,
      resource_id text,
      payload jsonb,
      created_at timestamptz not null default now()
    );

    create table if not exists zhupay_merchant_snapshots (
      id bigserial primary key,
      captured_at timestamptz not null default now(),
      pid text,
      status integer,
      pay_status integer,
      settle_status integer,
      balance numeric(14, 2),
      order_num integer,
      order_num_today integer,
      order_num_lastday integer,
      order_money_today numeric(14, 2),
      order_money_lastday numeric(14, 2),
      raw jsonb not null
    );

    create table if not exists zhupay_orders (
      trade_no text primary key,
      out_trade_no text,
      api_trade_no text,
      pid text,
      type text,
      status integer,
      trade_status text,
      name text,
      money numeric(14, 2),
      refund_money numeric(14, 2),
      param text,
      buyer text,
      clientip text,
      addtime timestamptz,
      endtime timestamptz,
      source text not null,
      raw jsonb not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create table if not exists creem_store_snapshots (
      id bigserial primary key,
      captured_at timestamptz not null default now(),
      currency text not null,
      total_revenue numeric(14, 2) not null default 0,
      today_revenue numeric(14, 2) not null default 0,
      transaction_count integer not null default 0,
      customer_count integer not null default 0,
      active_subscription_count integer not null default 0,
      past_due_subscription_count integer not null default 0,
      raw jsonb not null
    );

    create table if not exists creem_transactions (
      id text primary key,
      mode text,
      type text,
      status text,
      amount integer,
      amount_paid integer,
      refunded_amount integer,
      currency text,
      tax_amount integer,
      discount_amount integer,
      order_id text,
      subscription_id text,
      customer_id text,
      description text,
      period_start timestamptz,
      period_end timestamptz,
      source_created_at timestamptz,
      source text not null,
      raw jsonb not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create table if not exists creem_customers (
      id text primary key,
      mode text,
      email text,
      name text,
      country text,
      source_created_at timestamptz,
      source_updated_at timestamptz,
      source text not null,
      raw jsonb not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create table if not exists creem_subscriptions (
      id text primary key,
      mode text,
      status text,
      product_id text,
      customer_id text,
      last_transaction_id text,
      last_transaction_date timestamptz,
      next_transaction_date timestamptz,
      current_period_start_date timestamptz,
      current_period_end_date timestamptz,
      canceled_at timestamptz,
      source_created_at timestamptz,
      source_updated_at timestamptz,
      source text not null,
      raw jsonb not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create table if not exists creem_webhook_events (
      id text primary key,
      event_type text not null,
      source_created_at timestamptz,
      processed_at timestamptz not null default now(),
      raw jsonb not null
    );

    create table if not exists manual_revenue_entries (
      id uuid primary key,
      channel text not null,
      amount numeric(20, 8) not null check (amount > 0),
      currency text not null,
      note text,
      received_at timestamptz not null default now(),
      created_by uuid references users(id) on delete set null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create table if not exists nl2pcb_snapshots (
      id bigserial primary key,
      captured_at timestamptz not null default now(),
      user_count integer not null default 0,
      active_user_count integer not null default 0,
      disabled_user_count integer not null default 0,
      job_count integer not null default 0,
      feedback_count integer not null default 0,
      raw jsonb not null
    );

    create table if not exists nl2pcb_users (
      id text primary key,
      email text,
      disabled boolean,
      source_created_at timestamptz,
      last_login_at timestamptz,
      raw jsonb not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create table if not exists nl2pcb_jobs (
      id text primary key,
      status text,
      title text,
      user_id text,
      source_created_at timestamptz,
      source_updated_at timestamptz,
      raw jsonb not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create table if not exists nl2pcb_feedback (
      id text primary key,
      user_id text,
      email text,
      message text,
      source_created_at timestamptz,
      raw jsonb not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create table if not exists analytics_projects (
      id text primary key,
      name text not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create table if not exists analytics_project_origins (
      id uuid primary key,
      project_id text not null references analytics_projects(id) on delete cascade,
      origin text not null,
      created_at timestamptz not null default now(),
      unique (project_id, origin)
    );

    create table if not exists analytics_project_keys (
      id uuid primary key,
      project_id text not null references analytics_projects(id) on delete cascade,
      scope text not null check (scope in ('public', 'server')),
      key_hash text not null unique,
      key_prefix text not null,
      key_value text,
      created_at timestamptz not null default now(),
      last_used_at timestamptz
    );

    alter table if exists analytics_project_keys
      add column if not exists key_value text;

    create table if not exists analytics_events (
      id uuid primary key,
      project_id text not null references analytics_projects(id) on delete cascade,
      event_id text not null,
      name text not null,
      anonymous_id text,
      session_id text,
      user_id text,
      occurred_at timestamptz not null,
      received_at timestamptz not null default now(),
      url text,
      path text,
      title text,
      referrer text,
      referrer_host text,
      source text,
      medium text,
      campaign text,
      content text,
      term text,
      properties jsonb not null default '{}'::jsonb,
      context jsonb not null default '{}'::jsonb,
      raw jsonb not null default '{}'::jsonb,
      unique (project_id, event_id)
    );

    create table if not exists analytics_identities (
      id uuid primary key,
      project_id text not null references analytics_projects(id) on delete cascade,
      anonymous_id text not null,
      user_id text not null,
      first_seen_at timestamptz not null,
      last_seen_at timestamptz not null,
      unique (project_id, anonymous_id, user_id)
    );

    create table if not exists analytics_attributions (
      id uuid primary key,
      project_id text not null references analytics_projects(id) on delete cascade,
      user_id text not null,
      anonymous_id text,
      signup_event_id text,
      signup_at timestamptz not null,
      first_source text,
      first_medium text,
      first_campaign text,
      first_referrer_host text,
      first_landing_path text,
      last_source text,
      last_medium text,
      last_campaign text,
      last_referrer_host text,
      last_landing_path text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (project_id, user_id)
    );

    create table if not exists analytics_daily_rollups (
      project_id text not null references analytics_projects(id) on delete cascade,
      day date not null,
      source text not null,
      landing_views integer not null default 0,
      signup_started integer not null default 0,
      signups integer not null default 0,
      updated_at timestamptz not null default now(),
      primary key (project_id, day, source)
    );

    create or replace function source_key(source text, referrer_host text)
    returns text
    language sql
    immutable
    as $$
      select coalesce(nullif(trim(source), ''), nullif(trim(referrer_host), ''), 'direct')
    $$;

    create index if not exists sessions_expires_at_idx on sessions (expires_at);
    create index if not exists audit_logs_created_at_idx on audit_logs (created_at desc);
    create index if not exists zhupay_snapshots_captured_at_idx on zhupay_merchant_snapshots (captured_at desc);
    create index if not exists zhupay_orders_endtime_idx on zhupay_orders (endtime desc);
    create index if not exists zhupay_orders_status_idx on zhupay_orders (status);
    create index if not exists creem_snapshots_captured_at_idx on creem_store_snapshots (captured_at desc);
    create index if not exists creem_transactions_source_created_at_idx on creem_transactions (source_created_at desc);
    create index if not exists creem_transactions_status_idx on creem_transactions (status);
    create index if not exists creem_transactions_currency_idx on creem_transactions (currency);
    create index if not exists creem_subscriptions_status_idx on creem_subscriptions (status);
    create index if not exists manual_revenue_entries_received_at_idx on manual_revenue_entries (received_at desc);
    create index if not exists manual_revenue_entries_currency_idx on manual_revenue_entries (currency);
    create index if not exists manual_revenue_entries_created_by_idx on manual_revenue_entries (created_by);
    create index if not exists nl2pcb_snapshots_captured_at_idx on nl2pcb_snapshots (captured_at desc);
    create index if not exists nl2pcb_users_source_created_at_idx on nl2pcb_users (source_created_at desc);
    create index if not exists nl2pcb_users_disabled_idx on nl2pcb_users (disabled);
    create index if not exists nl2pcb_jobs_source_created_at_idx on nl2pcb_jobs (source_created_at desc);
    create index if not exists nl2pcb_jobs_status_idx on nl2pcb_jobs (status);
    create index if not exists nl2pcb_feedback_source_created_at_idx on nl2pcb_feedback (source_created_at desc);
    create index if not exists analytics_events_project_occurred_idx on analytics_events (project_id, occurred_at desc);
    create index if not exists analytics_events_project_name_occurred_idx on analytics_events (project_id, name, occurred_at desc);
    create index if not exists analytics_events_anonymous_idx on analytics_events (project_id, anonymous_id, occurred_at desc);
    create index if not exists analytics_events_user_idx on analytics_events (project_id, user_id, occurred_at desc);
    create index if not exists analytics_events_source_idx on analytics_events (project_id, source, referrer_host);
    create index if not exists analytics_attributions_signup_idx on analytics_attributions (project_id, signup_at desc);
    create index if not exists analytics_attributions_first_source_idx on analytics_attributions (project_id, first_source, first_referrer_host);
  `);

  await ensureDefaultAnalyticsProject();
  await pool.query(
    `
      insert into app_state (key, value)
      values ('main', $1::jsonb)
      on conflict (key) do nothing
    `,
    [JSON.stringify(defaultAppState)],
  );

  await ensureDefaultAppStateResources();
}

async function ensureDefaultAnalyticsProject() {
  await pool.query(
    `
      insert into analytics_projects (id, name)
      values ($1, $2)
      on conflict (id) do update
        set name = excluded.name,
            updated_at = now()
    `,
    [DEFAULT_ANALYTICS_PROJECT_ID, DEFAULT_ANALYTICS_PROJECT_NAME],
  );

  await ensureAnalyticsProjectKey(DEFAULT_ANALYTICS_PROJECT_ID, "public", DEFAULT_ANALYTICS_PUBLIC_KEY);
  await ensureAnalyticsProjectKey(DEFAULT_ANALYTICS_PROJECT_ID, "server", DEFAULT_ANALYTICS_SERVER_KEY);
}

async function ensureAnalyticsProjectKey(projectId, scope, key) {
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

async function ensureDefaultAppStateResources() {
  const result = await pool.query("select value from app_state where key = 'main'");
  const current = result.rows[0]?.value;
  if (!current || typeof current !== "object") {
    return;
  }

  const { state: next, changed } = mergeDefaultStateResources(current);
  if (!changed) {
    return;
  }

  await pool.query(
    `
      update app_state
      set value = $1::jsonb,
          updated_at = now()
      where key = 'main'
    `,
    [JSON.stringify(next)],
  );
}

function mergeDefaultStateResources(state) {
  let changed = false;
  const dashboardBase = Array.isArray(state.dashboards)
    ? state.dashboards
    : state.dashboard
      ? [state.dashboard]
      : defaultAppState.dashboards;
  changed = changed || !Array.isArray(state.dashboards);

  const dashboards = mergeDefaultsById(dashboardBase, defaultAppState.dashboards);
  const dataSources = mergeDefaultsById(
    Array.isArray(state.dataSources) ? state.dataSources : defaultAppState.dataSources,
    defaultAppState.dataSources,
  );
  const metrics = mergeDefaultsById(Array.isArray(state.metrics) ? state.metrics : defaultAppState.metrics, defaultAppState.metrics);
  const alerts = mergeDefaultsById(Array.isArray(state.alerts) ? state.alerts : defaultAppState.alerts, defaultAppState.alerts);
  const templates = mergeDefaultsById(
    Array.isArray(state.templates) ? state.templates : defaultAppState.templates,
    defaultAppState.templates,
  );
  changed = changed
    || !Array.isArray(state.dataSources)
    || !Array.isArray(state.metrics)
    || !Array.isArray(state.alerts)
    || !Array.isArray(state.templates)
    || dashboards.changed
    || dataSources.changed
    || metrics.changed
    || alerts.changed
    || templates.changed
    || !state.activeDashboardId;

  return {
    changed,
    state: {
      ...state,
      dataSources: dataSources.items,
      metrics: metrics.items,
      dashboards: dashboards.items,
      activeDashboardId: state.activeDashboardId ?? state.dashboard?.id ?? dashboards.items[0]?.id,
      alerts: alerts.items,
      templates: templates.items,
    },
  };
}

function mergeDefaultsById(items, defaults) {
  const merged = Array.isArray(items) ? [...items] : [];
  const existingIds = new Set(merged.map((item) => item?.id).filter(Boolean));
  let changed = false;

  for (const item of defaults) {
    if (!existingIds.has(item.id)) {
      merged.push(item);
      changed = true;
    }
  }

  return { items: merged, changed };
}
