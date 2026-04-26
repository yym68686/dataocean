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

This repo currently contains a runnable React/Vite MVP with seeded mock data.

Implemented:

- DataSource, Metric, ChartSpec, Dashboard, QueryResult domain models
- mock connector layer for API, Stripe, Prometheus, PostgreSQL, webhook, and CSV
- query engine with short-lived caching and auto-refreshing panel queries
- dashboard page with KPI, time-series, signal-list, status-card, and table panels
- Data Sources, Metrics, Alerts, Templates, and Settings pages
- right-side inspector that displays the selected panel's ChartSpec
- light/dark mode
- global time-range selector
- local Market Terminal design system

## Run Locally

```bash
npm install
npm run dev
```

Open:

```text
http://localhost:5173/
```

Build:

```bash
npm run build
```

## Architecture

```text
React App
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
```

Core abstractions:

- `DataSource`: where data comes from
- `MetricDefinition`: semantic metric mapped from raw fields
- `ChartSpec`: saved panel configuration
- `QueryEngine`: executes panel queries through connector adapters
- `PanelRenderer`: maps ChartSpec renderer types to UI components

## Directory Structure

```text
src/
  App.tsx
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

1. Replace mock connectors with a real Custom REST API connector.
2. Add persisted dashboards and ChartSpecs.
3. Add a backend API for credential storage and query execution.
4. Add SQL and PromQL query builders.
5. Add webhook ingestion and realtime push.
6. Add team access control.
7. Add AI-assisted metric and dashboard generation.

## Developer Context

Read `AGENTS.md` before making architectural or UI changes. It captures the
project direction, design constraints, current implementation state, and future
development defaults.
