import type { ChartSpec } from "../../../domain/types";
import { formatMetricValue } from "../../../lib/format";
import { usePanelQuery } from "../../../hooks/usePanelQuery";
import { useDisplayCurrency } from "../../../lib/displayCurrency";
import { useI18n } from "../../../lib/i18n";

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
  const { intlLocale, t, tx } = useI18n();
  const { currencyFormatOptions } = useDisplayCurrency();
  const { result } = usePanelQuery(panel);
  const rows = result?.rows.slice(-4) ?? [];

  return (
    <div>
      <div className="mt-card-header">
        <div>
          <h2 className="mt-card-title">{tx(panel.title)}</h2>
          <p className="mt-card-subtitle">{tx(panel.description)}</p>
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
                <div className="mt-market-title">{tx(signalLabels[index]) || t("panel.liveSignal")}</div>
                <div className="mt-market-meta">{tx(result?.meta.dataSource.name) || t("panel.source")} · {t("common.live")}</div>
              </div>
              <div className="mt-probability">
                {result?.meta.metric.format === "percent"
                  ? `${Math.round(probability * 100)}%`
                  : formatMetricValue(value, result?.meta.metric.format, result?.meta.unit, intlLocale, currencyFormatOptions)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
