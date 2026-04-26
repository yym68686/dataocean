import type { ChartSpec } from "../../../domain/types";
import { formatMetricValue } from "../../../lib/format";
import { usePanelQuery } from "../../../hooks/usePanelQuery";

type SignalListPanelProps = {
  panel: ChartSpec;
};

const signalLabels = [
  "Revenue beats daily target",
  "API latency remains under 120ms",
  "Checkout conversion above 6%",
  "Error budget burn stays normal",
];

export function SignalListPanel({ panel }: SignalListPanelProps) {
  const { result } = usePanelQuery(panel);
  const rows = result?.rows.slice(-4) ?? [];

  return (
    <div>
      <div className="mt-card-header">
        <div>
          <h2 className="mt-card-title">{panel.title}</h2>
          <p className="mt-card-subtitle">{panel.description}</p>
        </div>
      </div>
      <div>
        {rows.map((row, index) => {
          const value = Number(row.value);
          const probability = result?.meta.metric.format === "percent" ? value : Math.min(0.96, value / 150000);

          return (
            <div className="mt-market-row" key={`${row.timestamp}-${index}`}>
              <div className="mt-market-icon">{signalLabels[index]?.slice(0, 1) ?? "S"}</div>
              <div>
                <div className="mt-market-title">{signalLabels[index] ?? "Live signal"}</div>
                <div className="mt-market-meta">{result?.meta.dataSource.name ?? "source"} · live</div>
              </div>
              <div className="mt-probability">
                {result?.meta.metric.format === "percent"
                  ? `${Math.round(probability * 100)}%`
                  : formatMetricValue(value, result?.meta.metric.format, result?.meta.unit)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
