import pg from "pg";
import { defaultAppState } from "./defaultState.js";

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
  `);

  await pool.query(
    `
      insert into app_state (key, value)
      values ('main', $1::jsonb)
      on conflict (key) do nothing
    `,
    [JSON.stringify(defaultAppState)],
  );
}
