import { useEffect, useMemo, useRef } from "react";
import {
  AreaSeries,
  ColorType,
  createChart,
  LineSeries,
  type IChartApi,
  type ISeriesApi,
  type Time,
} from "lightweight-charts";
import type { ChartSpec } from "../../../domain/types";
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
};

export function TimeSeriesPanel({ panel }: TimeSeriesPanelProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Line" | "Area"> | null>(null);
  const { result, loading, error } = usePanelQuery(panel);
  const theme = document.documentElement.dataset.theme === "dark" ? "dark" : "light";

  const chartData = useMemo(
    () =>
      result?.rows.map((row) => ({
        time: Number(row.timestamp) as Time,
        value: Number(row.value),
      })) ?? [],
    [result],
  );

  const latest = Number(result?.rows.at(-1)?.value ?? 0);
  const delta = formatDelta(latest, result?.meta.previousValue, result?.meta.metric.format);

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

    const series =
      panel.style?.seriesStyle === "line"
        ? chart.addSeries(LineSeries, createMarketLineSeriesOptions(theme) as object)
        : chart.addSeries(AreaSeries, createMarketAreaSeriesOptions(theme) as object);

    chartRef.current = chart;
    seriesRef.current = series;

    const resizeObserver = new ResizeObserver(() => {
      chart.applyOptions({
        width: containerRef.current?.clientWidth,
        height: containerRef.current?.clientHeight,
      });
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [panel.style?.seriesStyle, theme]);

  useEffect(() => {
    if (seriesRef.current && chartData.length > 0) {
      seriesRef.current.setData(chartData);
      chartRef.current?.timeScale().fitContent();
    }
  }, [chartData]);

  return (
    <div className="do-chart-panel">
      <div className="mt-card-header">
        <div>
          <h2 className="mt-card-title">{panel.title}</h2>
          <p className="mt-card-subtitle">{panel.description}</p>
        </div>
        <div className="do-chart-readout">
          <span>{result ? formatMetricValue(latest, result.meta.metric.format, result.meta.unit) : "--"}</span>
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
        <span className="do-refresh-label">{loading ? "Querying..." : result?.meta.freshness ?? "idle"}</span>
      </div>

      {error ? <div className="do-panel-error">{error}</div> : <div className="do-lightweight-chart" ref={containerRef} />}
    </div>
  );
}
