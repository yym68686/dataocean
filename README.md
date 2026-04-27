# DataOcean

DataOcean is a configurable data terminal for custom data sources, semantic
metrics, and real-time dashboards. It is designed for teams that need one place
to monitor revenue, server health, service status, operational signals, and
other API-driven data.

The product direction is a modern financial-style dashboard: dense, clean,
light-first, fast, and inspired by Polymarket/TradingView-style data surfaces.

## What It Solves

Teams often keep important data across many systems:

- revenue in Stripe, Shopify, or databases
- infrastructure metrics in Prometheus or cloud providers
- service status in custom APIs, Sentry, logs, or StatusPage
- product metrics in analytics tools or internal tables
- operational data in spreadsheets, CRMs, and support systems

DataOcean provides a unified layer for:

- connecting custom data sources
- defining reusable semantic metrics
- saving dashboard panels as JSON ChartSpecs
- rendering live KPI, chart, table, and status panels
- building a reusable market-style command center

## Current MVP

This repo contains a runnable React/Vite UI served by a Node API. The API uses
PostgreSQL for accounts, sessions, API keys, audit logs, and persisted dashboard
state.

Implemented:

- DataSource, Metric, ChartSpec, Dashboard, QueryResult domain models
- email/password login without verification codes
- first registered user automatically becomes an admin
- per-user API keys, with admin keys allowed to mutate platform state
- PostgreSQL-backed app state and audit logs
- REST API for state, data sources, metrics, dashboards, panels, alerts, and templates
- connector registry for API, Stripe, Prometheus, PostgreSQL, webhook, and CSV
- no seeded business values; prepared panels stay empty/error until real credentials and sync are configured
- Zhupay V2 and Creem connector shells for real revenue monitoring with signed callbacks, scheduled sync, and local order storage
- query engine with short-lived caching and auto-refreshing panel queries
- dashboard page with KPI, time-series, signal-list, status-card, and table panels
- Data Sources, Metrics, Alerts, Templates, and Settings pages
- right-side inspector that displays the selected panel's ChartSpec
- light/dark mode
- global time-range selector
- local Market Terminal design system

## Run Locally

The easiest full-stack local run is Docker Compose:

```bash
docker compose up --build
```

Open:

```text
http://localhost:8080/
```

The first account created through the login page becomes the admin.

For frontend-only development:

```bash
npm install
npm run dev
```

Open:

```text
http://localhost:5173/
```

The Vite-only server needs an API backend separately for login and state APIs.

Build:

```bash
npm run build
```

## Run with Docker

Production stack with Node API and PostgreSQL:

```bash
docker compose up --build
```

Open:

```text
http://localhost:8080/
```

Use a different port:

```bash
DATAOCEAN_PORT=3000 docker compose up --build
```

## Architecture

```text
Browser
  -> React App
  -> Dashboard / Sources / Metrics / Alerts / Templates
  -> PanelRenderer
      -> KPI Renderer
      -> Lightweight Time Series Renderer
      -> Signal List Renderer
      -> Status Card Renderer
      -> Table Renderer
  -> ChartSpec JSON
  -> Query Engine
  -> Connector Registry
      -> Custom API
      -> Stripe
      -> Prometheus
      -> PostgreSQL
      -> Webhook
      -> CSV

Node API
  -> Auth / Sessions / API Keys
  -> App State API
  -> Resource CRUD API
  -> Audit Logs
  -> PostgreSQL
```

Core abstractions:

- `DataSource`: where data comes from
- `MetricDefinition`: semantic metric mapped from raw fields
- `ChartSpec`: saved panel configuration
- `QueryEngine`: executes panel queries through connector adapters
- `PanelRenderer`: maps ChartSpec renderer types to UI components
- `User`: account with role and API key scope

## API Surface

Authentication:

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `POST /api/auth/api-key/rotate`

State and resources:

- `GET /api/state`
- `PUT /api/state`
- `GET|POST /api/data-sources`
- `PATCH|DELETE /api/data-sources/:id`
- `GET|POST /api/metrics`
- `PATCH|DELETE /api/metrics/:id`
- `GET|POST /api/dashboards`
- `PATCH|DELETE /api/dashboards/:id`
- `POST /api/dashboards/:dashboardId/panels`
- `PATCH|DELETE /api/dashboards/:dashboardId/panels/:panelId`
- `GET|POST /api/alerts`
- `PATCH|DELETE /api/alerts/:id`
- `GET|POST /api/templates`
- `PATCH|DELETE /api/templates/:id`

Admin:

- `GET /api/admin/users`
- `GET /api/admin/audit-logs`

Zhupay:

- `GET /api/connectors/zhupay/status`
- `POST /api/connectors/zhupay/sync`
- `GET /api/connectors/zhupay/scheduler`
- `GET /api/connectors/zhupay/summary`
- `GET /api/connectors/zhupay/orders`
- `GET /api/connectors/zhupay/notify`

Creem:

- `GET /api/connectors/creem/status`
- `POST /api/connectors/creem/sync`
- `GET /api/connectors/creem/scheduler`
- `GET /api/connectors/creem/summary`
- `GET /api/connectors/creem/transactions`
- `POST /api/connectors/creem/webhook`

Send session tokens or API keys with:

```http
Authorization: Bearer <token-or-api-key>
```

Admin:

- `GET /api/admin/users`
- `DELETE /api/admin/users/:userId`
- `GET /api/admin/audit-logs`

Admin routes require an admin session or admin-scoped API key. The UI shows the
admin navigation group only to admin users. User deletion revokes that user's
sessions through database cascades and prevents deleting the current admin
account.

## Zhupay Setup

The Zhupay connector is server-side only. Browser code never receives the
merchant private key.

Set these environment variables in Fugue:

```text
ZHUPAY_BASE_URL=https://pay.lxsd.cn
ZHUPAY_PID=<merchant id>
ZHUPAY_MERCHANT_PRIVATE_KEY=<merchant RSA private key>
ZHUPAY_PLATFORM_PUBLIC_KEY=<platform RSA public key>
ZHUPAY_SYNC_ENABLED=true
ZHUPAY_SYNC_INTERVAL_MS=60000
ZHUPAY_SYNC_MAX_PAGES=4
ZHUPAY_SYNC_LIMIT=50
```

After setting them, restart/redeploy the app, then call:

```bash
curl -X POST https://dataocean.fugue.pro/api/connectors/zhupay/sync \
  -H "Authorization: Bearer $DATAOCEAN_ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"maxPages":4,"limit":50}'
```

Configure Zhupay `notify_url` to:

```text
https://dataocean.fugue.pro/api/connectors/zhupay/notify
```

The callback verifies the Zhupay RSA signature and stores only successful paid
orders.

If changing the existing payment application is difficult, keep `notify_url`
unchanged and enable scheduled sync instead. With `ZHUPAY_SYNC_ENABLED=true`,
DataOcean polls Zhupay merchant info and paid orders on
`ZHUPAY_SYNC_INTERVAL_MS`, stores merchant snapshots, and upserts orders by
`trade_no`. The scheduler skips overlapping runs and exposes its current status
through:

```http
GET /api/connectors/zhupay/scheduler
```

## Creem Setup

The Creem connector is server-side only. Browser code never receives the Creem
API key or webhook secret.

Set these environment variables in Fugue:

```text
CREEM_API_KEY=<creem_... or creem_test_...>
CREEM_WEBHOOK_SECRET=<webhook signing secret>
CREEM_CURRENCY=USD
CREEM_SYNC_ENABLED=true
CREEM_SYNC_INTERVAL_MS=3600000
CREEM_SYNC_MAX_PAGES=4
CREEM_SYNC_PAGE_SIZE=50
```

Use an API key with at least these read scopes: `transactions:read`,
`customers:read`, and `subscriptions:read`. Creem production keys use the
`creem_` prefix and sandbox keys use `creem_test_`; DataOcean infers the API
base URL from that prefix unless `CREEM_BASE_URL` is explicitly set.

After setting credentials, call:

```bash
curl -X POST https://dataocean.fugue.pro/api/connectors/creem/sync \
  -H "Authorization: Bearer $DATAOCEAN_ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"maxPages":4,"pageSize":50}'
```

Optional webhook endpoint:

```text
https://dataocean.fugue.pro/api/connectors/creem/webhook
```

The webhook verifies the `creem-signature` HMAC-SHA256 header with
`CREEM_WEBHOOK_SECRET`, stores the event, and updates transactions, customers,
subscriptions, and summary snapshots. If webhook setup would disturb the
existing app, leave it disabled and rely on scheduled sync.

## Directory Structure

```text
src/
  App.tsx
  api/
    client.ts
  data/
    seed.ts
  domain/
    constants.ts
    types.ts
  services/
    connectors.ts
    queryEngine.ts
  hooks/
    usePanelQuery.ts
  components/
    Inspector.tsx
    panels/
  pages/
  styles/

server/
  index.js
  database.js
  store.js
  security.js
  defaultState.js

design-system/
  css/market-system.css
  tokens/
  charts/
  spec/
  preview/
  research/
```

## Design System

The local design system is `Market Terminal Design System`.

Key files:

- `design-system/css/market-system.css`
- `design-system/tokens/market.tokens.json`
- `design-system/tokens/market-tokens.ts`
- `design-system/charts/lightweight-chart-theme.ts`
- `design-system/spec/chart-spec.schema.json`

Design rules:

- light-first, with dark mode support
- compact cards with 1px borders and 8px radius
- restrained blue primary accent
- green/red only for directional state
- right-axis time-series charts
- low shadow, no glassmorphism, no decorative gradients
- do not expose raw default chart-library themes

## Next Steps

Recommended next implementation steps:

1. Add a real Custom REST API connector.
2. Move data source credentials into a dedicated encrypted vault.
3. Add a backend API for credential storage and query execution.
4. Add SQL and PromQL query builders.
5. Add webhook ingestion and realtime push.
6. Add team access control.
7. Add AI-assisted metric and dashboard generation.

## Developer Context

Read `AGENTS.md` before making architectural or UI changes. It captures the
project direction, design constraints, current implementation state, and future
development defaults.
