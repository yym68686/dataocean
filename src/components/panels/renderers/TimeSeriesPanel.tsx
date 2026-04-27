import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import {
  AreaSeries,
  ColorType,
  createChart,
  LineSeries,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type MouseEventParams,
  type Time,
} from "lightweight-charts";
import type { ChartSpec, QueryRow, ThemeMode } from "../../../domain/types";
import { timeRanges } from "../../../domain/constants";
import { formatDelta, formatMetricValue } from "../../../lib/format";
import { usePanelQuery } from "../../../hooks/usePanelQuery";
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

type HoverPriceLine = {
  series: ISeriesApi<"Line" | "Area">;
  line: IPriceLine;
};

const seriesColors = ["#1652f0", "#00a37a", "#f59e0b", "#7c3aed", "#ef4444"];

export function TimeSeriesPanel({ panel, theme }: TimeSeriesPanelProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRefs = useRef<Map<string, ISeriesApi<"Line" | "Area">>>(new Map());
  const hoverPriceLineRef = useRef<HoverPriceLine | null>(null);
  const { result, loading, error } = usePanelQuery(panel);
  const chartSeries = useMemo(() => createChartSeries(result?.rows ?? [], panel.title), [panel.title, result]);

  const hasValue = Boolean(result?.rows.length);
  const latest = getLatestValue(chartSeries, result?.rows.at(-1)?.value);
  const delta = hasValue
    ? formatDelta(latest, result?.meta.previousValue, result?.meta.metric.format)
    : { intent: "neutral" as const, label: "waiting" };

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    const chart = createChart(containerRef.current, {
      ...(createMarketChartOptions(theme) as object),
      autoSize: true,
      layout: {
        ...(createMarketChartOptions(theme) as { layout: object }).layout,
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
      if (!param.point) {
        clearHoverPriceLine(hoverPriceLineRef);
        return;
      }

      const hoveredSeries = param.hoveredInfo?.series ?? param.hoveredSeries;
      const targetSeries = resolveHoverSeries(chart, hoveredSeries, param, seriesRefs.current);
      if (!targetSeries) {
        clearHoverPriceLine(hoverPriceLineRef);
        return;
      }

      const value = getSeriesDataValue(param.seriesData.get(targetSeries));
      if (value === undefined) {
        clearHoverPriceLine(hoverPriceLineRef);
        return;
      }

      showHoverPriceLine(hoverPriceLineRef, targetSeries, value, getSeriesColor(targetSeries, seriesRefs.current));
    };

    chart.subscribeCrosshairMove(handleCrosshairMove);

    return () => {
      chart.unsubscribeCrosshairMove(handleCrosshairMove);
      clearHoverPriceLine(hoverPriceLineRef);
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRefs.current = new Map();
    };
  }, [panel.style?.seriesStyle, theme]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) {
      return;
    }

    const nextNames = new Set(chartSeries.map((series) => series.name));
    for (const [name, series] of seriesRefs.current.entries()) {
      if (!nextNames.has(name)) {
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

    if (chartSeries.some((series) => series.data.length > 0)) {
      chart.timeScale().fitContent();
    }
  }, [chartSeries, panel, theme]);

  return (
    <div className="do-chart-panel">
      <div className="mt-card-header">
        <div>
          <h2 className="mt-card-title">{panel.title}</h2>
          <p className="mt-card-subtitle">{panel.description}</p>
        </div>
        <div className="do-chart-readout">
          <span>{hasValue && result ? formatMetricValue(latest, result.meta.metric.format, result.meta.unit) : "--"}</span>
          <span className="mt-badge" data-intent={delta.intent === "neutral" ? undefined : delta.intent}>
            {delta.label}
          </span>
        </div>
      </div>

      <div className="do-chart-controls">
        <div className="mt-segmented">
          {timeRanges.map((range) => (
            <button className="mt-segment" data-active={panel.query.timeRange === range.value} key={range.value} type="button">
              {range.label}
            </button>
          ))}
        </div>
        {result?.meta.warnings?.length ? (
          <span className="mt-badge" title={result.meta.warnings.join("\n")}>partial</span>
        ) : null}
        <span className="do-refresh-label">{loading ? "Querying..." : result?.meta.freshness ?? "idle"}</span>
      </div>

      {chartSeries.length > 1 ? (
        <div className="do-chart-legend">
          {chartSeries.map((series, index) => (
            <span key={series.name}>
              <i style={{ background: seriesColors[index % seriesColors.length] }} />
              {series.name}
            </span>
          ))}
        </div>
      ) : null}

      {error ? <div className="do-panel-error">{error}</div> : <div className="do-lightweight-chart" ref={containerRef} />}
    </div>
  );
}

function createChartSeries(rows: QueryRow[], fallbackName: string): ChartSeries[] {
  const byName = new Map<string, ChartSeries>();

  for (const row of rows) {
    const name = String(row.series ?? fallbackName);
    const series = byName.get(name) ?? { name, data: [] };
    series.data.push({
      time: Number(row.timestamp) as Time,
      value: Number(row.value),
    });
    byName.set(name, series);
  }

  return Array.from(byName.values()).map((series) => ({
    ...series,
    data: series.data.sort((left, right) => Number(left.time) - Number(right.time)),
  }));
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

function resolveHoverSeries(
  chart: IChartApi,
  hoveredSeries: unknown,
  param: MouseEventParams<Time>,
  seriesRefs: Map<string, ISeriesApi<"Line" | "Area">>,
) {
  if (hoveredSeries && isPanelSeries(hoveredSeries, seriesRefs)) {
    return hoveredSeries;
  }

  const nearestSeries = findNearestSeriesPoint(chart, param, seriesRefs);
  if (nearestSeries) {
    return nearestSeries;
  }

  const totalSeries = seriesRefs.get("Total");
  if (totalSeries && param.seriesData.has(totalSeries)) {
    return totalSeries;
  }

  for (const series of seriesRefs.values()) {
    if (param.seriesData.has(series)) {
      return series;
    }
  }

  return undefined;
}

function findNearestSeriesPoint(
  chart: IChartApi,
  param: MouseEventParams<Time>,
  seriesRefs: Map<string, ISeriesApi<"Line" | "Area">>,
) {
  if (!param.point || param.time === undefined) {
    return undefined;
  }

  const x = chart.timeScale().timeToCoordinate(param.time);
  if (x === null) {
    return undefined;
  }

  let nearest: { series: ISeriesApi<"Line" | "Area">; distance: number } | undefined;
  for (const series of seriesRefs.values()) {
    const value = getSeriesDataValue(param.seriesData.get(series));
    if (value === undefined) {
      continue;
    }

    const y = series.priceToCoordinate(value);
    if (y === null) {
      continue;
    }

    const distance = Math.hypot(Number(x) - param.point.x, Number(y) - param.point.y);
    if (!nearest || distance < nearest.distance) {
      nearest = { series, distance };
    }
  }

  return nearest && nearest.distance <= 12 ? nearest.series : undefined;
}

function showHoverPriceLine(
  hoverPriceLineRef: MutableRefObject<HoverPriceLine | null>,
  series: ISeriesApi<"Line" | "Area">,
  value: number,
  color: string,
) {
  if (hoverPriceLineRef.current?.series !== series) {
    clearHoverPriceLine(hoverPriceLineRef);
    hoverPriceLineRef.current = {
      series,
      line: series.createPriceLine({
        price: value,
        color,
        lineWidth: 1,
        lineVisible: false,
        axisLabelVisible: true,
        axisLabelColor: color,
        axisLabelTextColor: "#ffffff",
        title: "",
      }),
    };
    return;
  }

  hoverPriceLineRef.current.line.applyOptions({
    price: value,
    color,
    axisLabelColor: color,
    axisLabelTextColor: "#ffffff",
    lineVisible: false,
    axisLabelVisible: true,
  });
}

function clearHoverPriceLine(hoverPriceLineRef: MutableRefObject<HoverPriceLine | null>) {
  if (!hoverPriceLineRef.current) {
    return;
  }

  hoverPriceLineRef.current.series.removePriceLine(hoverPriceLineRef.current.line);
  hoverPriceLineRef.current = null;
}

function isPanelSeries(value: unknown, seriesRefs: Map<string, ISeriesApi<"Line" | "Area">>): value is ISeriesApi<"Line" | "Area"> {
  for (const series of seriesRefs.values()) {
    if (series === value) {
      return true;
    }
  }
  return false;
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
