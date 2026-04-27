# Polymarket-Style Extraction Notes

## Source Signals

The local style system was informed by public Polymarket surfaces and the public
`@polymarket/embeds@1.3.0` package metadata/source available from npm.

Observed design signals:

- Font family in embeds: `Open Sauce Sans`.
- Light theme base: white surfaces, neutral gray type, very light borders.
- Dark theme base: navy-gray surfaces with muted blue-gray text.
- Main chart line in light mode: `#1652f0`.
- Main chart line in dark mode: `#2d9cdb`.
- Positive color: `#00b955`.
- Negative/orange-red color: `#e64800`.
- Core radius: `8px`.
- Core spacing step: `4px`.
- Compact type scale: `10px`, `11px`, `13px`, `15px`, `18px`.
- Embed card pattern: 1px border, white surface, 20px padding, compact rows.
- Chart pattern: transparent background, weak horizontal grid, hidden vertical
  grid, right-side price/value axis, no loud chart chrome.

See `polymarket-dark-theme.md` for the full dark-theme summary, including
surface hierarchy, chart colors, control behavior, and state-color rules.

## Interpretation

The important part is not a specific CSS file. The product feel comes from:

- high information density
- restrained color
- small interaction targets that still feel precise
- financial-chart conventions
- low decoration
- predictable card/table layouts

## Implementation Boundary

This repo intentionally does not copy Polymarket logos, SVG paths, font files,
market images, copywriting, or proprietary product layouts. The resulting design
system is an original implementation with a similar modern financial-dashboard
direction.
