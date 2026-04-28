import type { ChartSpec, QueryColumn, QueryRow } from "../../../domain/types";
import { formatDateTime, formatMetricValue, formatNumber, type CurrencyFormatOptions } from "../../../lib/format";
import { usePanelQuery } from "../../../hooks/usePanelQuery";
import { useDisplayCurrency } from "../../../lib/displayCurrency";
import { useI18n } from "../../../lib/i18n";

type TablePanelProps = {
  panel: ChartSpec;
};

export function TablePanel({ panel }: TablePanelProps) {
  const { intlLocale, t, tx } = useI18n();
  const { currencyFormatOptions } = useDisplayCurrency();
  const { result, loading, error } = usePanelQuery(panel);
  const columns = result?.columns ?? [];
  const rows = result?.rows.slice(0, 20) ?? [];

  return (
    <div>
      <div className="mt-card-header">
        <div>
          <h2 className="mt-card-title">{tx(panel.title)}</h2>
          <p className="mt-card-subtitle">{tx(panel.description)}</p>
        </div>
        <span className="mt-badge" data-intent={error ? "negative" : undefined}>
          {error ? t("common.error") : loading ? t("common.querying") : result?.meta.freshness ? t(`common.${result.meta.freshness}`) : ""}
        </span>
      </div>

      {error ? (
        <div className="do-panel-error">{error}</div>
      ) : rows.length === 0 ? (
        <div className="do-empty-state">
          <h2>{t("panel.noRowsTitle")}</h2>
          <p>{t("panel.noRowsText")}</p>
        </div>
      ) : (
        <div className="do-table-scroll">
          <table className="mt-table">
            <thead>
              <tr>
                {columns.map((column) => (
                  <th key={column.key}>{tx(column.label)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={createRowKey(row, index)}>
                  {columns.map((column) => (
                    <td key={column.key}>{formatCell(row, column, intlLocale, tx, currencyFormatOptions)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function formatCell(
  row: QueryRow,
  column: QueryColumn,
  locale: string,
  tx: (text?: string | null) => string,
  currencyFormatOptions: CurrencyFormatOptions,
) {
  const value = row[column.key];

  if (value === undefined || value === null || value === "") {
    return "--";
  }
  if (column.type === "time") {
    return formatDateTime(typeof value === "number" ? value : String(value), locale);
  }
  if (column.type === "number") {
    if (column.format) {
      return formatMetricValue(Number(value), column.format, column.unit, locale, currencyFormatOptions);
    }
    if (isCurrencyAmountColumn(row, column)) {
      return formatMetricValue(Number(value), "currency", String(row.currency), locale, currencyFormatOptions);
    }
    return formatNumber(Number(value), locale);
  }

  return tx(String(value));
}

function isCurrencyAmountColumn(row: QueryRow, column: QueryColumn) {
  if (!row.currency || typeof row.currency !== "string") {
    return false;
  }
  return ["amount", "money", "value"].includes(column.key);
}

function createRowKey(row: QueryRow, index: number) {
  return String(row.id ?? row.trade_no ?? row.out_trade_no ?? row.timestamp ?? index);
}
