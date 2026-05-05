# DataOcean Agent Notes

## Product Direction

DataOcean is intended to become a general-purpose, configurable data terminal:
custom data sources, custom dashboard panels, and modern real-time charting for
server health, revenue, operations, and market-style signals.

The product should feel like a modern financial information platform rather than
a generic BI demo. The working visual reference is Polymarket-inspired:
light-first, dense, clean, low-decoration, data-prioritized, and fast.

## Current Local Assets

- `package.json` - Vite/React/TypeScript build plus Node API start script.
- `Dockerfile` - builds the React app and runs the Node API/static server.
- `docker-compose.yml` - production-like `dataocean + postgres` topology.
- `index.html` - Vite app entry.
- `src/` - current React MVP implementation.
- `src/api/client.ts` - browser API client for auth and app state.
- `src/domain/types.ts` - core DataSource, Metric, ChartSpec, Dashboard, QueryResult types.
- `src/data/seed.ts` - bootstrap source/metric/panel definitions; do not add fake business values here.
- `src/services/connectors.ts` - connector interface/registry; connectors must not synthesize fake query data.
- `src/services/queryEngine.ts` - panel query execution and short-lived cache.
- `src/components/panels/` - renderer split for KPI, Lightweight Charts time series, status card, signal list, and table.
- `server/` - Node/Express API for auth, API keys, app state CRUD, and PostgreSQL persistence.
- `server/zhupay.js` - Zhupay V2 RSA connector, callback verification, sync, and query mapping.
- `server/creem.js` - Creem API-key connector, HMAC webhook verification, scheduled sync, and query mapping.
- `server/sub2api.js` - Sub2API admin connector; reads real group usage, caches API responses briefly, and converts configured channel spend into earned revenue.
- `server/nl2pcb.js` - NL2PCB Admin API connector; reads users, jobs, and feedback server-side, then caches records in PostgreSQL for operational dashboards.
- `design-system/README.md` - design system overview and usage.
- `design-system/css/market-system.css` - CSS variables and reusable component classes.
- `design-system/tokens/market.tokens.json` - source design tokens.
- `design-system/tokens/market-tokens.ts` - TypeScript token export.
- `design-system/charts/lightweight-chart-theme.ts` - TradingView Lightweight Charts theme helpers.
- `design-system/spec/chart-spec.schema.json` - draft dashboard ChartSpec JSON schema.
- `design-system/research/polymarket-style-notes.md` - notes from public style signals.
- `design-system/preview/index.html` - baseline style-guide preview.

## Design System Summary

Name: `Market Terminal Design System`

Style:

- Polymarket-inspired, but do not copy Polymarket branding, logos, SVGs, copy, or proprietary layouts.
- Light-first interface with optional dark mode.
- Financial terminal feel: compact cards, tight typography, right-axis charts, restrained palette.
- Use white/light-gray surfaces, subtle borders, very low shadow, and 8px card radius.
- Primary accent is blue: `#1652f0` in light mode, `#2d9cdb` in dark chart contexts.
- Positive is `#00b955`; negative/orange-red is `#e64800`.
- Neutral text is gray-blue, around `#858a98`.
- Prefer one or two data colors per chart. Avoid rainbow palettes.
- Dark theme is navy-gray and restrained: `#172330` page, `#1d2b39`
  surface, `#344452` borders/grid, `#899cb2` axis text, and `#2d9cdb`
  primary chart line. See `design-system/research/polymarket-dark-theme.md`.

Avoid:

- Gradients as page backgrounds.
- Glassmorphism.
- Heavy shadows.
- Purple/blue sci-fi dashboards.
- Oversized marketing hero sections.
- Rounded pill-heavy UI everywhere.
- Raw default themes from ECharts/G2/Vega/Recharts.

## UI Patterns

Use:

- Sidebar + topbar + dashboard grid + optional right inspector.
- Compact cards with `1px` borders and small radius.
- Segmented controls for time ranges: `1H / 1D / 1W / 1M / ALL`.
- Dense KPI cards.
- Market-style signal rows: icon, title, metadata, probability/value.
- Dense tables with hover states.
- Right-side panel inspector for ChartSpec/config.

The UI should prioritize scanning, comparison, and repeated daily use.

## Charting Direction

Default chart feel should match TradingView/Polymarket-style time-series charts:

- Transparent chart background.
- Weak horizontal grid.
- Hidden or very subtle vertical grid.
- Right-side value axis.
- Small axis labels.
- Smooth hover/crosshair.
- Compact range switcher.
- Minimal decoration.

Recommended renderer split:

```text
ChartSpec JSON
  -> lightweight-timeseries renderer for most metric/revenue/server charts
  -> D3/Canvas renderer for custom or unusual visuals
  -> KPI renderer for summary values
  -> TanStack Table-style renderer for dense tables
```

Do not make ECharts/G2/Vega the primary visual direction unless explicitly asked.
They may still be useful later as adapters, but their default visual style is not
the target.

## Architecture Direction

Current deployed stack:

```text
React / Vite
Node / Express
PostgreSQL
Market Terminal Design System
TradingView Lightweight Charts
```

Current API behavior:

- Email/password login, no verification code.
- First registered user automatically becomes `admin`; later users become `member`.
- Every user has an API key. Admin API keys can mutate state; member API keys are read-oriented.
- Admin-only UI lives under the separate sidebar Admin group. `AdminUsersPage`
  lists users and can delete non-current users through `DELETE /api/admin/users/:userId`.
- PostgreSQL stores `users`, `sessions`, `app_state`, and `audit_logs`.
- PostgreSQL also stores real Zhupay snapshots/orders, Creem snapshots/transactions/customers/subscriptions, and NL2PCB users/jobs/feedback/snapshots.
- App state contains data sources, metrics, dashboards, panels, alerts, and templates.
- Use `Authorization: Bearer <session-token-or-api-key>` or `X-API-Key`.
- Zhupay credentials must be provided as environment variables: `ZHUPAY_PID`,
  `ZHUPAY_MERCHANT_PRIVATE_KEY`, and `ZHUPAY_PLATFORM_PUBLIC_KEY`.
- Zhupay can run without touching the payment app by enabling scheduled sync:
  `ZHUPAY_SYNC_ENABLED=true`, `ZHUPAY_SYNC_INTERVAL_MS=60000`,
  `ZHUPAY_SYNC_MAX_PAGES=4`, and `ZHUPAY_SYNC_LIMIT=50`.
- Creem credentials must be provided as environment variables: `CREEM_API_KEY`
  and optionally `CREEM_WEBHOOK_SECRET`. Creem scheduled sync uses
  `CREEM_SYNC_ENABLED=true`, `CREEM_SYNC_INTERVAL_MS=3600000`,
  `CREEM_SYNC_MAX_PAGES=4`, and `CREEM_SYNC_PAGE_SIZE=50`.
- Sub2API credentials must be provided as `SUB2API_ADMIN_API_KEY`. The current
  revenue model reads `SUB2API_CHANNELS=codex,codexplus`, treats their
  `actual_cost` as B-side usage spend, and records earned revenue as
  `actual_cost * SUB2API_PROFIT_RATE` with default rate `0.025`.
- NL2PCB credentials must be provided as `NL2PCB_ADMIN_KEY`. Scheduled sync uses
  `NL2PCB_SYNC_ENABLED=true`, `NL2PCB_SYNC_INTERVAL_MS=300000`, and
  `NL2PCB_SYNC_LIMIT=200`. Browser code must never receive the admin key.

Long-term intended stack:

```text
React / Next.js
TypeScript
Market Terminal Design System
TradingView Lightweight Charts
D3 + Canvas for custom visualizations
TanStack Query for data fetching
TanStack Table for tables
Zustand or similar for dashboard editor state
PostgreSQL for app metadata
Redis/cache for query results and live state
```

Core concepts:

- Data sources are pluggable.
- Dashboard panels are saved as JSON.
- Do not bind UI directly to raw database fields.
- Add a semantic layer: metrics, dimensions, filters, time ranges.
- Convert internal `ChartSpec` into renderer-specific options.

Draft ChartSpec schema lives at `design-system/spec/chart-spec.schema.json`.

## Development Defaults

When extending this project:

- Reuse `design-system/css/market-system.css` classes and tokens first.
- Add or update tokens before adding one-off colors.
- Keep component spacing on a 4px scale.
- Keep card radius at 8px unless there is a strong reason.
- Prefer compact UI; avoid landing-page composition.
- Keep text small but readable.
- Build actual product screens, not marketing pages.
- Use icons for controls when a familiar icon exists.
- Verify responsive behavior at mobile and desktop widths.

## Current State

This is now a runnable full-stack MVP. It implements the first product loop:
email/password auth, admin-first bootstrap, per-user API keys, PostgreSQL-backed
dashboard state, semantic metrics, ChartSpec-backed panels, auto-refreshing panel
queries, and a Polymarket-inspired UI.

The app intentionally contains no fake business/ops values. Zhupay, Creem,
Sub2API, and NL2PCB source, metric, and panel definitions may be present, but
values must come from real provider APIs or verified callbacks/webhooks.

The next implementation step should be to add real Custom REST API execution,
encrypted credential storage, and server-side query execution with caching and
team-level access control.
