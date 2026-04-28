import type { ChartSpec } from "../../../domain/types";
import { formatDelta, formatMetricValue } from "../../../lib/format";
import { usePanelQuery } from "../../../hooks/usePanelQuery";
import { useDisplayCurrency } from "../../../lib/displayCurrency";
import { useI18n } from "../../../lib/i18n";

type KpiPanelProps = {
  panel: ChartSpec;
};

export function KpiPanel({ panel }: KpiPanelProps) {
  const { intlLocale, t, tx } = useI18n();
  const { currencyFormatOptions } = useDisplayCurrency();
  const { result, loading, error } = usePanelQuery(panel);
  const hasValue = Boolean(result?.rows.length);
  const latest = Number(hasValue ? result?.rows.at(-1)?.value : 0);
  const delta = hasValue
    ? formatDelta(latest, result?.meta.previousValue, result?.meta.metric.format, t("common.live"))
    : { intent: "neutral" as const, label: t("common.waiting") };
  const value = hasValue && result
    ? formatMetricValue(latest, result.meta.metric.format, result.meta.unit, intlLocale, currencyFormatOptions)
    : "--";
  const warnings = result?.meta.warnings ?? [];

  return (
    <div className="do-kpi-panel">
      <div className="mt-kpi-label">{tx(panel.title)}</div>
      <div className="mt-kpi-value">{loading ? "..." : value}</div>
      <div className="mt-kpi-meta">
        {error ? (
          <span className="mt-badge" data-intent="negative">
            {t("common.error")}
          </span>
        ) : (
          <span className="mt-badge" data-intent={delta.intent === "neutral" ? undefined : delta.intent}>
            {delta.label}
          </span>
        )}
        {warnings.length > 0 ? <span className="mt-badge" title={warnings.join("\n")}>{t("common.partial")}</span> : null}
        <span>{result?.meta.freshness ? t(`common.${result.meta.freshness}`) : t("common.querying")}</span>
      </div>
    </div>
  );
}
