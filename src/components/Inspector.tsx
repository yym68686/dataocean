import type { AppSection, ChartSpec, DataSource, MetricDefinition } from "../domain/types";
import { getDataSource, getMetric } from "../services/queryEngine";
import { useI18n } from "../lib/i18n";

type InspectorProps = {
  activeSection: AppSection;
  panel?: ChartSpec;
  dataSources: DataSource[];
  metrics: MetricDefinition[];
};

export function Inspector({ activeSection, panel, dataSources, metrics }: InspectorProps) {
  const { t, tx } = useI18n();
  let metric;
  let dataSource;

  if (panel) {
    try {
      metric = getMetric(panel.query.metric);
      dataSource = getDataSource(panel.query.dataSourceId);
    } catch {
      metric = undefined;
      dataSource = undefined;
    }
  }

  return (
    <aside className="mt-inspector">
      <div className="mt-config-section">
        <h2 className="mt-config-title">{t("inspector.activeContext")}</h2>
        <div className="do-mini-stat">
          <span>{t("inspector.section")}</span>
          <strong>{t(`section.${activeSection}`)}</strong>
        </div>
        <div className="do-mini-stat">
          <span>{t("inspector.sources")}</span>
          <strong>{dataSources.length}</strong>
        </div>
        <div className="do-mini-stat">
          <span>{t("inspector.metrics")}</span>
          <strong>{metrics.length}</strong>
        </div>
      </div>

      {panel && metric && dataSource ? (
        <div className="mt-config-section">
          <h2 className="mt-config-title">{t("inspector.selectedPanel")}</h2>
          <label className="mt-field">
            <span className="mt-label">{t("inspector.title")}</span>
            <input className="mt-input" readOnly value={tx(panel.title)} />
          </label>
          <label className="mt-field">
            <span className="mt-label">{t("inspector.renderer")}</span>
            <input className="mt-input" readOnly value={panel.renderer} />
          </label>
          <label className="mt-field">
            <span className="mt-label">{t("inspector.metric")}</span>
            <input className="mt-input" readOnly value={tx(metric.name)} />
          </label>
          <label className="mt-field">
            <span className="mt-label">{t("inspector.source")}</span>
            <input className="mt-input" readOnly value={tx(dataSource.name)} />
          </label>
        </div>
      ) : (
        <div className="mt-config-section">
          <h2 className="mt-config-title">{t("inspector.selectedPanel")}</h2>
          <p className="do-empty-copy">{t("inspector.noPanel")}</p>
        </div>
      )}

      {panel ? (
        <div className="mt-config-section">
          <h2 className="mt-config-title">ChartSpec</h2>
          <pre className="mt-card do-code-block">{JSON.stringify(panel, null, 2)}</pre>
        </div>
      ) : null}
    </aside>
  );
}
