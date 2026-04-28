import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import {
  AreaSeries,
  ColorType,
  createChart,
  LineSeries,
  LineStyle,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type MouseEventParams,
  type Time,
} from "lightweight-charts";
import type { ChartSpec, MetricFormat, QueryRow, ThemeMode, TimeRange } from "../../../domain/types";
import { timeRanges } from "../../../domain/constants";
import { convertMetricValue, formatDelta, formatMetricValue, type CurrencyFormatOptions } from "../../../lib/format";
import { usePanelQuery } from "../../../hooks/usePanelQuery";
import { useDisplayCurrency } from "../../../lib/displayCurrency";
import { useI18n } from "../../../lib/i18n";
import {
  createMarketAreaSeriesOptions,
  createMarketChartOptions,
  createMarketLineSeriesOptions,
} from "../../../../design-system/charts/lightweight-chart-theme";

type TimeSeriesPanelProps = {
  panel: ChartSpec;
  theme: ThemeMode;
};

type ChartSeries = {
  name: string;
  data: Array<{ time: Time; value: number }>;
};

const seriesColors = ["#1652f0", "#00a37a", "#f59e0b", "#7c3aed", "#ef4444"];

export function TimeSeriesPanel({ panel, theme }: TimeSeriesPanelProps) {
  const { intlLocale, t, tx } = useI18n();
  const { currencyFormatOptions } = useDisplayCurrency();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRefs = useRef<Map<string, ISeriesApi<"Line" | "Area">>>(new Map());
  const hoverPriceLinesRef = useRef<Map<ISeriesApi<"Line" | "Area">, IPriceLine>>(new Map());
  const [selectedRange, setSelectedRange] = useState(panel.query.timeRange);
  const queryPanel = useMemo(
    () => ({
      ...panel,
      query: {
        ...panel.query,
        timeRange: selectedRange,
      },
    }),
    [panel, selectedRange],
  );
  const { result, loading, error } = usePanelQuery(queryPanel);
  const chartSeries = useMemo(
    () => createChartSeries(
      result?.rows ?? [],
      panel.title,
      selectedRange,
      result?.meta.metric.format,
      result?.meta.unit,
      currencyFormatOptions,
    ),
    [currencyFormatOptions, panel.title, result, selectedRange],
  );
  const displayUnit = result
    ? convertMetricValue(0, result.meta.metric.format, result.meta.unit, currencyFormatOptions).unit
    : undefined;

  const hasValue = Boolean(result?.rows.length);
  const latest = getLatestValue(chartSeries, result?.rows.at(-1)?.value);
  const previousValue = result
    ? convertMetricValue(Number(result.meta.previousValue ?? latest), result.meta.metric.format, result.meta.unit, currencyFormatOptions).value
    : undefined;
  const delta = hasValue
    ? formatDelta(latest, previousValue, result?.meta.metric.format, t("common.live"))
    : { intent: "neutral" as const, label: t("common.waiting") };

  useEffect(() => {
    setSelectedRange(panel.query.timeRange);
  }, [panel.id, panel.query.timeRange]);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    const chart = createChart(containerRef.current, {
      ...(createMarketChartOptions(theme, intlLocale) as object),
      autoSize: true,
      layout: {
        ...(createMarketChartOptions(theme, intlLocale) as { layout: object }).layout,
        background: { type: ColorType.Solid, color: "transparent" },
      },
    });

    chartRef.current = chart;
    seriesRefs.current = new Map();

    const resizeObserver = new ResizeObserver(() => {
      chart.applyOptions({
        width: containerRef.current?.clientWidth,
        height: containerRef.current?.clientHeight,
      });
    });
    resizeObserver.observe(containerRef.current);

    const handleCrosshairMove = (param: MouseEventParams<Time>) => {
      if (!param.point || param.time === undefined) {
        clearHoverPriceLines(hoverPriceLinesRef);
        return;
      }

      showHoverPriceLines(hoverPriceLinesRef, param.seriesData, seriesRefs.current);
    };

    chart.subscribeCrosshairMove(handleCrosshairMove);

    return () => {
      chart.unsubscribeCrosshairMove(handleCrosshairMove);
      clearHoverPriceLines(hoverPriceLinesRef);
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRefs.current = new Map();
    };
  }, [intlLocale, panel.style?.seriesStyle, theme]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) {
      return;
    }

    const nextNames = new Set(chartSeries.map((series) => series.name));
    for (const [name, series] of seriesRefs.current.entries()) {
      if (!nextNames.has(name)) {
        removeHoverPriceLine(hoverPriceLinesRef, series);
        chart.removeSeries(series);
        seriesRefs.current.delete(name);
      }
    }

    chartSeries.forEach((series, index) => {
      const existing = seriesRefs.current.get(series.name);
      const chartApi = existing ?? addPanelSeries(chart, panel, theme, index, chartSeries.length);

      if (!existing) {
        seriesRefs.current.set(series.name, chartApi);
      }
      chartApi.applyOptions(getSeriesDisplayOptions(series, chartSeries.length));
      chartApi.setData(series.data);
    });

    chart.applyOptions({
      localization: {
        priceFormatter: (price: number) => result
          ? formatMetricValue(price, result.meta.metric.format, displayUnit, intlLocale)
          : new Intl.NumberFormat(intlLocale, { notation: "compact", maximumFractionDigits: 1 }).format(price),
      },
    });

    if (chartSeries.some((series) => series.data.length > 0)) {
      chart.timeScale().fitContent();
    }
  }, [chartSeries, displayUnit, intlLocale, panel, result, theme]);

  return (
    <div className="do-chart-panel">
      <div className="mt-card-header">
        <div>
          <h2 className="mt-card-title">{tx(panel.title)}</h2>
          <p className="mt-card-subtitle">{tx(panel.description)}</p>
        </div>
        <div className="do-chart-readout">
          <span>{hasValue && result ? formatMetricValue(latest, result.meta.metric.format, displayUnit, intlLocale) : "--"}</span>
          <span className="mt-badge" data-intent={delta.intent === "neutral" ? undefined : delta.intent}>
            {delta.label}
          </span>
        </div>
      </div>

      <div className="do-chart-controls">
        <div className="mt-segmented">
          {timeRanges.map((range) => (
            <button
              className="mt-segment"
              data-active={selectedRange === range.value}
              key={range.value}
              onClick={() => setSelectedRange(range.value)}
              type="button"
            >
              {range.label}
            </button>
          ))}
        </div>
        {result?.meta.warnings?.length ? (
          <span className="mt-badge" title={result.meta.warnings.join("\n")}>{t("common.partial")}</span>
        ) : null}
        <span className="do-refresh-label">{loading ? t("common.querying") : result?.meta.freshness ? t(`common.${result.meta.freshness}`) : t("common.idle")}</span>
      </div>

      {chartSeries.length > 1 ? (
        <div className="do-chart-legend">
          {chartSeries.map((series, index) => (
            <span key={series.name}>
              <i style={{ background: seriesColors[index % seriesColors.length] }} />
              {tx(series.name)}
            </span>
          ))}
        </div>
      ) : null}

      {error ? <div className="do-panel-error">{error}</div> : <div className="do-lightweight-chart" ref={containerRef} />}
    </div>
  );
}

function createChartSeries(
  rows: QueryRow[],
  fallbackName: string,
  timeRange: TimeRange,
  format?: MetricFormat,
  unit?: string,
  currencyFormatOptions?: CurrencyFormatOptions,
): ChartSeries[] {
  const byName = new Map<string, Map<number, number>>();
  const allTimes = new Set<number>();

  for (const row of rows) {
    const name = String(row.series ?? fallbackName);
    const time = Number(row.timestamp);
    const value = convertMetricValue(Number(row.value), format, unit, currencyFormatOptions).value;

    if (!Number.isFinite(time) || !Number.isFinite(value)) {
      continue;
    }

    const series = byName.get(name) ?? new Map<number, number>();
    series.set(time, (series.get(time) ?? 0) + value);
    byName.set(name, series);
    allTimes.add(time);
  }

  const timeline = createDenseTimeline(Array.from(allTimes), timeRange);

  return Array.from(byName.entries()).map(([name, values]) => ({
    name,
    data: timeline.map((time) => ({
      time: time as Time,
      value: values.get(time) ?? 0,
    })),
  }));
}

function createDenseTimeline(times: number[], timeRange: TimeRange) {
  const sorted = Array.from(new Set(times)).sort((left, right) => left - right);
  if (sorted.length < 2) {
    return sorted;
  }

  const step = inferStepSeconds(sorted, timeRange);
  if (!step) {
    return sorted;
  }

  const dense = new Set(sorted);
  for (let time = sorted[0]; time <= sorted[sorted.length - 1]; time += step) {
    dense.add(time);
  }

  return Array.from(dense).sort((left, right) => left - right);
}

function inferStepSeconds(times: number[], timeRange: TimeRange) {
  if (times.every((time) => time % 86400 === 0)) {
    return 86400;
  }

  const diffs = times
    .slice(1)
    .map((time, index) => time - times[index])
    .filter((diff) => diff > 0)
    .sort((left, right) => left - right);
  const fallback = getFallbackStepSeconds(timeRange);
  const smallestDiff = diffs[0];

  if (!smallestDiff) {
    return fallback;
  }
  if (smallestDiff > fallback && smallestDiff % fallback === 0) {
    return fallback;
  }

  return smallestDiff;
}

function getFallbackStepSeconds(timeRange: TimeRange) {
  return {
    "1h": 5 * 60,
    "1d": 60 * 60,
    "1w": 6 * 60 * 60,
    "1m": 24 * 60 * 60,
    all: 24 * 60 * 60,
  }[timeRange];
}

function addPanelSeries(
  chart: IChartApi,
  panel: ChartSpec,
  theme: ThemeMode,
  index: number,
  seriesCount: number,
): ISeriesApi<"Line" | "Area"> {
  const color = seriesColors[index % seriesColors.length];

  if (seriesCount > 1 || panel.style?.seriesStyle === "line") {
    return chart.addSeries(LineSeries, {
      ...(createMarketLineSeriesOptions(theme) as object),
      color,
    }) as ISeriesApi<"Line" | "Area">;
  }

  return chart.addSeries(AreaSeries, {
    ...(createMarketAreaSeriesOptions(theme) as object),
    lineColor: color,
    topColor: `${color}38`,
    bottomColor: `${color}05`,
  }) as ISeriesApi<"Line" | "Area">;
}

function getSeriesDisplayOptions(series: ChartSeries, seriesCount: number) {
  if (seriesCount <= 1) {
    return {};
  }

  const isSinglePoint = series.data.length < 2;
  const isTotal = series.name.toLowerCase() === "total";

  return {
    lineVisible: !isSinglePoint,
    pointMarkersVisible: isSinglePoint,
    pointMarkersRadius: 4,
    lastValueVisible: false,
  };
}

function showHoverPriceLines(
  hoverPriceLinesRef: MutableRefObject<Map<ISeriesApi<"Line" | "Area">, IPriceLine>>,
  seriesData: MouseEventParams<Time>["seriesData"],
  seriesRefs: Map<string, ISeriesApi<"Line" | "Area">>,
) {
  const visibleSeries = new Set<ISeriesApi<"Line" | "Area">>();

  for (const series of seriesRefs.values()) {
    const value = getSeriesDataValue(seriesData.get(series));
    if (value === undefined) {
      continue;
    }

    visibleSeries.add(series);
    const color = getSeriesColor(series, seriesRefs);
    const existing = hoverPriceLinesRef.current.get(series);

    if (existing) {
      existing.applyOptions({
        price: value,
        color,
        axisLabelColor: color,
        axisLabelTextColor: "#ffffff",
        lineStyle: LineStyle.Dashed,
        lineVisible: true,
        axisLabelVisible: true,
      });
      continue;
    }

    hoverPriceLinesRef.current.set(
      series,
      series.createPriceLine({
        price: value,
        color,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        lineVisible: true,
        axisLabelVisible: true,
        axisLabelColor: color,
        axisLabelTextColor: "#ffffff",
        title: "",
      }),
    );
  }

  for (const [series, line] of Array.from(hoverPriceLinesRef.current.entries())) {
    if (!visibleSeries.has(series)) {
      series.removePriceLine(line);
      hoverPriceLinesRef.current.delete(series);
    }
  }
}

function removeHoverPriceLine(
  hoverPriceLinesRef: MutableRefObject<Map<ISeriesApi<"Line" | "Area">, IPriceLine>>,
  series: ISeriesApi<"Line" | "Area">,
) {
  const line = hoverPriceLinesRef.current.get(series);
  if (!line) {
    return;
  }

  series.removePriceLine(line);
  hoverPriceLinesRef.current.delete(series);
}

function clearHoverPriceLines(hoverPriceLinesRef: MutableRefObject<Map<ISeriesApi<"Line" | "Area">, IPriceLine>>) {
  for (const [series, line] of hoverPriceLinesRef.current.entries()) {
    series.removePriceLine(line);
  }

  hoverPriceLinesRef.current.clear();
}

function getSeriesDataValue(data: unknown) {
  if (!data || typeof data !== "object" || !("value" in data)) {
    return undefined;
  }

  const value = Number((data as { value?: unknown }).value);
  return Number.isFinite(value) ? value : undefined;
}

function getSeriesColor(series: ISeriesApi<"Line" | "Area">, seriesRefs: Map<string, ISeriesApi<"Line" | "Area">>) {
  const index = Array.from(seriesRefs.values()).indexOf(series);
  return seriesColors[Math.max(index, 0) % seriesColors.length];
}

function getLatestValue(series: ChartSeries[], fallback?: string | number | boolean) {
  const total = series.find((item) => item.name.toLowerCase() === "total");
  const target = total ?? series.at(-1);
  const value = target?.data.at(-1)?.value ?? fallback ?? 0;
  return Number(value);
}
