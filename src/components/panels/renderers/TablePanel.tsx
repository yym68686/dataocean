import type { ChartSpec } from "../../../domain/types";
import { formatDateTime, formatMetricValue } from "../../../lib/format";
import { usePanelQuery } from "../../../hooks/usePanelQuery";

type TablePanelProps = {
  panel: ChartSpec;
};

export function TablePanel({ panel }: TablePanelProps) {
  const { result, loading } = usePanelQuery(panel);
  const rows = result?.rows.slice(-6).reverse() ?? [];

  return (
    <div>
      <div className="mt-card-header">
        <div>
          <h2 className="mt-card-title">{panel.title}</h2>
          <p className="mt-card-subtitle">{panel.description}</p>
        </div>
        <span className="mt-badge">{loading ? "querying" : result?.meta.freshness}</span>
      </div>
      <table className="mt-table">
        <thead>
          <tr>
            <th>Time</th>
            <th>Source</th>
            <th>Metric</th>
            <th>Status</th>
            <th>Value</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const value = Number(row.value);
            const formatted = result ? formatMetricValue(value, result.meta.metric.format, result.meta.unit) : "--";
            const status = index === 2 ? "watch" : "normal";

            return (
              <tr key={`${row.timestamp}-${index}`}>
                <td>{formatDateTime(Number(row.timestamp))}</td>
                <td>{result?.meta.dataSource.name}</td>
                <td>{result?.meta.metric.name}</td>
                <td>
                  <span className={status === "normal" ? "mt-positive" : "mt-negative"}>{status}</span>
                </td>
                <td>{formatted}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
