# Polymarket-Inspired Dark Theme Summary

This document summarizes the dark-theme direction for DataOcean's Market
Terminal Design System. It is informed by public Polymarket embed style signals
and adapted into original DataOcean tokens and rules. Do not copy Polymarket
logos, proprietary layouts, SVGs, or product copy.

## Theme Character

The dark theme should feel like a financial terminal, not a neon dashboard.

Keywords:

- dark navy-gray
- muted blue-gray text
- low contrast containers
- crisp borders
- bright but restrained cyan-blue data line
- green/orange-red only for state
- compact and high-density

The goal is calm readability during long monitoring sessions. Avoid theatrical
dark-mode styling.

## Core Palette

Current DataOcean dark tokens:

```text
page              #172330
surface           #1d2b39
surfaceMuted      #2c3f4f
surfaceRaised     #233444
text              #ffffff
textMuted         #858d92
textSubtle        #6f7f8d
border            #344452
borderSubtle      #2c3f4f
grid              #344452
axis              #899cb2
primary           #2d9cdb
primaryHover      #55b8ed
primarySoft       #17374a
positive          #00b955
positiveSoft      #103b2a
negative          #e64800
negativeSoft      #4a2519
neutral           #858d92
warning           #f59e0b
```

## Surface Hierarchy

Use a narrow surface stack:

```text
app background    page
sidebar           mix(page, surface)
cards             surface
raised controls   surfaceMuted / surfaceRaised
hover states      surfaceMuted
selected states   primarySoft + primary border
```

Rules:

- Cards should not float with heavy shadows.
- Borders are more important than shadows.
- Keep card radius at 8px.
- Avoid pure black backgrounds.
- Avoid large dark gradients.

## Typography

Use the same compact type scale as light mode:

```text
10px metadata
11px captions, badges, axis labels
13px normal UI text
15px compact headings
18px KPI / readout emphasis
22px page title
```

Text hierarchy:

```text
primary text      #ffffff
secondary text    #858d92
subtle text       #6f7f8d
axis labels       #899cb2
```

Rules:

- Do not over-brighten all text.
- Reserve white for values, headings, and primary labels.
- Metadata should stay muted.

## Chart Theme

Dark charts should match the TradingView/Polymarket-style time-series surface.

Chart defaults:

```text
background        transparent
main line         #2d9cdb
area top          rgba(45, 156, 219, 0.22)
area bottom       rgba(45, 156, 219, 0)
grid              #344452
axis text         #899cb2
crosshair         rgba(137, 156, 178, 0.18-0.24)
price axis        right side
vertical grid     hidden or very subtle
```

Rules:

- Prefer one primary series color.
- Use area fill sparingly and with low opacity.
- Keep grid lines weak.
- Keep tooltips compact.
- Avoid multicolor default chart palettes.
- Do not use glow effects around lines.

## Controls

Buttons, segmented controls, and inputs should use surface contrast instead of
bright outlines.

Recommended behavior:

```text
default button    surfaceMuted
hover button      border / raised surface
primary button    primary
input background  surface
input border      border
focus ring        primary with low alpha
```

Rules:

- Keep controls small: 32px height where possible.
- Segmented controls should feel precise, not pill-heavy.
- Icons should inherit text color unless stateful.

## State Colors

State colors should remain semantic:

```text
positive          #00b955
negative          #e64800
warning           #f59e0b
primary action    #2d9cdb
```

Rules:

- Green means healthy/up/yes/success.
- Orange-red means down/no/risk/error.
- Warning should be used rarely.
- Do not use green/red as general decoration.

## DataOcean Implementation

Implemented in:

- `design-system/tokens/market.tokens.json`
- `design-system/tokens/market-tokens.ts`
- `design-system/css/market-system.css`
- `design-system/charts/lightweight-chart-theme.ts`

Runtime theme switch:

```html
<html data-theme="dark">
```

React chart helpers:

```ts
createMarketChartOptions("dark")
createMarketLineSeriesOptions("dark")
createMarketAreaSeriesOptions("dark")
```

## Do Not Do

- Do not use pure black as the app background.
- Do not add neon glows.
- Do not use large gradients or decorative blobs.
- Do not make every panel a different dark shade.
- Do not make status colors the primary palette.
- Do not turn the dashboard into a sci-fi control room.
