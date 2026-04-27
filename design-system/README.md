# Market Terminal Design System

This is a local, Polymarket-inspired design system for a modern data dashboard.
It captures the product feel: dense financial UI, clean cards, restrained color,
light borders, right-axis time-series charts, and fast interactions.

This is not a Polymarket clone and does not include Polymarket logos, trademarks,
font files, or proprietary assets. The system uses original naming and reusable
tokens that can be adapted to your product.

## Files

- `tokens/market.tokens.json` - source design tokens.
- `tokens/market-tokens.ts` - TypeScript token export.
- `css/market-system.css` - CSS variables and component classes.
- `charts/lightweight-chart-theme.ts` - TradingView Lightweight Charts theme.
- `spec/chart-spec.schema.json` - JSON schema for dashboard chart configs.
- `preview/index.html` - static local preview.
- `research/polymarket-style-notes.md` - extraction notes and design rules.
- `research/polymarket-dark-theme.md` - dark-theme summary and implementation rules.

## Visual Direction

- Light-first interface with optional dark mode.
- Low-shadow cards with 1px borders and 8px radius.
- Tight typography, small controls, compact tables.
- Blue is the primary data/accent color.
- Green and orange-red are reserved for directional states.
- Charts use transparent backgrounds, weak grid lines, right-side value axes,
  compact labels, and minimal decoration.

## Dark Theme

The dark theme is a restrained navy-gray financial terminal theme, not a neon
analytics dashboard.

Core dark tokens:

```text
page              #172330
surface           #1d2b39
surfaceMuted      #2c3f4f
surfaceRaised     #233444
text              #ffffff
textMuted         #858d92
border            #344452
axis              #899cb2
primary chart     #2d9cdb
positive          #00b955
negative          #e64800
```

Rules:

- Use borders and surface contrast instead of heavy shadows.
- Avoid pure black backgrounds.
- Keep chart grids weak and chart backgrounds transparent.
- Use `#2d9cdb` as the main dark-mode time-series line.
- Keep green/red reserved for directional state.
- Avoid neon glows, large gradients, and sci-fi dashboard styling.

Full notes: `research/polymarket-dark-theme.md`.

## Recommended Stack

```text
React / Next.js
Tailwind or CSS modules
TradingView Lightweight Charts for time series
D3 + Canvas for custom visuals
TanStack Table for dense data tables
```

## Usage

For plain HTML/CSS:

```html
<link rel="stylesheet" href="./design-system/css/market-system.css" />
```

For React:

```ts
import { marketTokens } from "./design-system/tokens/market-tokens";
import { createMarketChartOptions } from "./design-system/charts/lightweight-chart-theme";
```

Open `preview/index.html` directly in a browser to inspect the baseline style.

## Design Guardrails

- Keep cards compact. Avoid oversized hero layouts.
- Avoid gradients, glassmorphism, heavy shadows, and decorative blobs.
- Do not expose chart-library default themes.
- Prefer 1-2 strong series colors over broad palettes.
- Use right-axis time-series charts for live operational and revenue metrics.
- Treat tables, filters, and charts as one product surface, not separate widgets.
