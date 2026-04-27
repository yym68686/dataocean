import type { AppSection, ChartSpec, DataSource, MetricDefinition } from "../domain/types";
import { getDataSource, getMetric } from "../services/queryEngine";

type InspectorProps = {
  activeSection: AppSection;
  panel?: ChartSpec;
  dataSources: DataSource[];
  metrics: MetricDefinition[];
};

export function Inspector({ activeSection, panel, dataSources, metrics }: InspectorProps) {
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
        <h2 className="mt-config-title">Active Context</h2>
        <div className="do-mini-stat">
          <span>Section</span>
          <strong>{activeSection}</strong>
        </div>
        <div className="do-mini-stat">
          <span>Sources</span>
          <strong>{dataSources.length}</strong>
        </div>
        <div className="do-mini-stat">
          <span>Metrics</span>
          <strong>{metrics.length}</strong>
        </div>
      </div>

      {panel && metric && dataSource ? (
        <div className="mt-config-section">
          <h2 className="mt-config-title">Selected Panel</h2>
          <label className="mt-field">
            <span className="mt-label">Title</span>
            <input className="mt-input" readOnly value={panel.title} />
          </label>
          <label className="mt-field">
            <span className="mt-label">Renderer</span>
            <input className="mt-input" readOnly value={panel.renderer} />
          </label>
          <label className="mt-field">
            <span className="mt-label">Metric</span>
            <input className="mt-input" readOnly value={metric.name} />
          </label>
          <label className="mt-field">
            <span className="mt-label">Source</span>
            <input className="mt-input" readOnly value={dataSource.name} />
          </label>
        </div>
      ) : (
        <div className="mt-config-section">
          <h2 className="mt-config-title">Selected Panel</h2>
          <p className="do-empty-copy">No real panel has been configured yet.</p>
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
