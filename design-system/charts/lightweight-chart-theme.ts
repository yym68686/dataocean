import { getMarketPalette, type MarketTheme } from "../tokens/market-tokens";

export const MARKET_TIME_RANGES = [
  { label: "1H", value: "1h", seconds: 60 * 60 },
  { label: "1D", value: "1d", seconds: 24 * 60 * 60 },
  { label: "1W", value: "1w", seconds: 7 * 24 * 60 * 60 },
  { label: "1M", value: "1m", seconds: 30 * 24 * 60 * 60 },
  { label: "1Y", value: "1y", seconds: 365 * 24 * 60 * 60 },
  { label: "ALL", value: "all", seconds: null },
] as const;

export function createMarketChartOptions(theme: MarketTheme = "light") {
  const color = getMarketPalette(theme);

  return {
    layout: {
      background: { color: "transparent" },
      textColor: color.axis,
      fontSize: 11,
      fontFamily: "inherit",
    },
    grid: {
      vertLines: { visible: false },
      horzLines: {
        visible: true,
        color: color.grid,
        style: 1,
      },
    },
    crosshair: {
      mode: 1,
      vertLine: {
        visible: true,
        color: theme === "dark" ? "rgba(137,156,178,0.24)" : "rgba(119,128,141,0.24)",
        width: 1,
        style: 2,
        labelVisible: false,
      },
      horzLine: {
        visible: true,
        color: theme === "dark" ? "rgba(137,156,178,0.18)" : "rgba(119,128,141,0.18)",
        width: 1,
        style: 2,
        labelVisible: false,
      },
    },
    rightPriceScale: {
      visible: true,
      borderVisible: false,
      scaleMargins: { top: 0.08, bottom: 0.08 },
      mode: 0,
      autoScale: true,
    },
    leftPriceScale: { visible: false },
    timeScale: {
      visible: true,
      borderVisible: true,
      borderColor: color.grid,
      timeVisible: true,
      secondsVisible: false,
      rightOffset: 6,
      barSpacing: 6,
    },
    localization: {
      priceFormatter: (price: number) => price >= 0 && price <= 1
        ? `${(price * 100).toFixed(0)}%`
        : Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(price),
    },
    handleScroll: {
      mouseWheel: true,
      pressedMouseMove: true,
      horzTouchDrag: true,
      vertTouchDrag: false,
    },
    handleScale: {
      axisPressedMouseMove: true,
      mouseWheel: true,
      pinch: true,
    },
  };
}

export function createMarketLineSeriesOptions(theme: MarketTheme = "light") {
  const color = getMarketPalette(theme);

  return {
    color: color.primary,
    lineWidth: 2,
    lineType: 2,
    priceLineVisible: false,
    lastValueVisible: true,
    crosshairMarkerVisible: true,
    crosshairMarkerRadius: 4,
    crosshairMarkerBorderColor: color.surface,
    crosshairMarkerBorderWidth: 2,
    crosshairMarkerBackgroundColor: color.primary,
  };
}

export function createMarketAreaSeriesOptions(theme: MarketTheme = "light") {
  const color = getMarketPalette(theme);

  return {
    lineColor: color.primary,
    topColor: theme === "dark" ? "rgba(45, 156, 219, 0.22)" : "rgba(22, 82, 240, 0.18)",
    bottomColor: theme === "dark" ? "rgba(45, 156, 219, 0.00)" : "rgba(22, 82, 240, 0.00)",
    lineWidth: 2,
    priceLineVisible: false,
    lastValueVisible: true,
  };
}
