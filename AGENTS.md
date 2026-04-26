# DataOcean Agent Notes

## Product Direction

DataOcean is intended to become a general-purpose, configurable data terminal:
custom data sources, custom dashboard panels, and modern real-time charting for
server health, revenue, operations, and market-style signals.

The product should feel like a modern financial information platform rather than
a generic BI demo. The working visual reference is Polymarket-inspired:
light-first, dense, clean, low-decoration, data-prioritized, and fast.

## Current Local Assets

- `package.json` - Vite/React/TypeScript app scripts and dependencies.
- `index.html` - Vite app entry.
- `src/` - current React MVP implementation.
- `src/domain/types.ts` - core DataSource, Metric, ChartSpec, Dashboard, QueryResult types.
- `src/data/seed.ts` - seeded demo data sources, metrics, dashboard panels, alerts, and templates.
- `src/services/connectors.ts` - mock connector interface/implementation for API, SQL, Prometheus, Stripe, webhook, CSV.
- `src/services/queryEngine.ts` - panel query execution and short-lived cache.
- `src/components/panels/` - renderer split for KPI, Lightweight Charts time series, status card, signal list, and table.
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

This is now a runnable React/Vite MVP. It implements the first product loop:
seeded data sources, semantic metrics, ChartSpec-backed dashboard panels, mock
connector execution, auto-refreshing panel queries, and a Polymarket-inspired UI.

The next implementation step should be to replace the mock connector layer with
real Custom REST API execution, add persisted dashboard storage, and introduce a
backend API for credentials, query execution, and team-level access control.
