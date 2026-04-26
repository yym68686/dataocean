import type { ChartSpec } from "../../../domain/types";
import { formatDelta, formatMetricValue } from "../../../lib/format";
import { usePanelQuery } from "../../../hooks/usePanelQuery";

type KpiPanelProps = {
  panel: ChartSpec;
};

export function KpiPanel({ panel }: KpiPanelProps) {
  const { result, loading, error } = usePanelQuery(panel);
  const latest = Number(result?.rows.at(-1)?.value ?? 0);
  const delta = formatDelta(latest, result?.meta.previousValue, result?.meta.metric.format);
  const value = result ? formatMetricValue(latest, result.meta.metric.format, result.meta.unit) : "--";

  return (
    <div className="do-kpi-panel">
      <div className="mt-kpi-label">{panel.title}</div>
      <div className="mt-kpi-value">{loading ? "..." : value}</div>
      <div className="mt-kpi-meta">
        {error ? (
          <span className="mt-badge" data-intent="negative">
            error
          </span>
        ) : (
          <span className="mt-badge" data-intent={delta.intent === "neutral" ? undefined : delta.intent}>
            {delta.label}
          </span>
        )}
        <span>{result?.meta.freshness ?? "querying"}</span>
      </div>
    </div>
  );
}
