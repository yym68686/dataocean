import type { ChartSpec, DataSource } from "../../../domain/types";
import { usePanelQuery } from "../../../hooks/usePanelQuery";
import { useI18n } from "../../../lib/i18n";

type StatusCardPanelProps = {
  panel: ChartSpec;
  dataSources: DataSource[];
};

export function StatusCardPanel({ panel, dataSources }: StatusCardPanelProps) {
  const { t, tx, te } = useI18n();
  const { result } = usePanelQuery(panel);

  return (
    <div>
      <div className="mt-card-header">
        <div>
          <h2 className="mt-card-title">{tx(panel.title)}</h2>
          <p className="mt-card-subtitle">{tx(panel.description)}</p>
        </div>
      </div>
      <div className="do-status-list">
        {dataSources.slice(0, 3).map((source) => (
          <div className="do-status-row" key={source.id}>
            <div>
              <strong>{tx(source.name)}</strong>
              <span>{te("kind", source.kind)} · {t("panel.fields", { count: source.fields.length })}</span>
            </div>
            <span className="mt-badge" data-intent={source.status === "live" ? "positive" : undefined}>
              {te("status", source.status)}
            </span>
          </div>
        ))}
      </div>
      <div className="do-status-footer">
        <span>{t("panel.freshness")}</span>
        <strong>{result?.meta.freshness ? t(`common.${result.meta.freshness}`) : t("common.loading")}</strong>
      </div>
    </div>
  );
}
