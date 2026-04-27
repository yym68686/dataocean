import type { ChartSpec, QueryColumn, QueryRow } from "../../../domain/types";
import { formatDateTime, formatMetricValue } from "../../../lib/format";
import { usePanelQuery } from "../../../hooks/usePanelQuery";

type TablePanelProps = {
  panel: ChartSpec;
};

export function TablePanel({ panel }: TablePanelProps) {
  const { result, loading, error } = usePanelQuery(panel);
  const columns = result?.columns ?? [];
  const rows = result?.rows.slice(0, 10) ?? [];

  return (
    <div>
      <div className="mt-card-header">
        <div>
          <h2 className="mt-card-title">{panel.title}</h2>
          <p className="mt-card-subtitle">{panel.description}</p>
        </div>
        <span className="mt-badge" data-intent={error ? "negative" : undefined}>
          {error ? "error" : loading ? "querying" : result?.meta.freshness}
        </span>
      </div>

      {error ? (
        <div className="do-panel-error">{error}</div>
      ) : rows.length === 0 ? (
        <div className="do-empty-state">
          <h2>No rows yet</h2>
          <p>Rows will appear after the real connector syncs data.</p>
        </div>
      ) : (
        <table className="mt-table">
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column.key}>{column.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={createRowKey(row, index)}>
                {columns.map((column) => (
                  <td key={column.key}>{formatCell(row, column)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function formatCell(row: QueryRow, column: QueryColumn) {
  const value = row[column.key];

  if (value === undefined || value === null || value === "") {
    return "--";
  }
  if (column.type === "time") {
    return formatDateTime(Number(value));
  }
  if (column.type === "number") {
    if (column.format) {
      return formatMetricValue(Number(value), column.format, column.unit);
    }
    return Number(value).toLocaleString();
  }

  return String(value);
}

function createRowKey(row: QueryRow, index: number) {
  return String(row.id ?? row.trade_no ?? row.out_trade_no ?? row.timestamp ?? index);
}
