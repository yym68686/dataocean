import type { Dashboard, DataSource, MetricDefinition, ThemeMode, TimeRange } from "../domain/types";
import { PanelRenderer } from "../components/panels/PanelRenderer";

type DashboardPageProps = {
  dashboard: Dashboard;
  dataSources: DataSource[];
  metrics: MetricDefinition[];
  activeRange: TimeRange;
  selectedPanelId?: string;
  theme: ThemeMode;
  onSelectPanel: (panelId: string) => void;
};

export function DashboardPage({
  dashboard,
  dataSources,
  metrics,
  activeRange,
  selectedPanelId,
  theme,
  onSelectPanel,
}: DashboardPageProps) {
  const activeSources = dataSources.filter((source) => ["live", "polling", "synced"].includes(source.status)).length;

  return (
    <>
      <section className="do-query-strip" aria-label="Dashboard summary">
        <div className="do-query-chip">
          <span className="do-query-label">Dashboard</span>
          <strong>{dashboard.name}</strong>
        </div>
        <div className="do-query-chip">
          <span className="do-query-label">Time Range</span>
          <strong>{activeRange.toUpperCase()}</strong>
        </div>
        <div className="do-query-chip">
          <span className="do-query-label">Active Sources</span>
          <strong>{activeSources} / {dataSources.length}</strong>
        </div>
        <div className="do-query-chip">
          <span className="do-query-label">Semantic Metrics</span>
          <strong>{metrics.length}</strong>
        </div>
      </section>

      <section className="mt-grid do-dashboard-grid">
        {dashboard.panels.map((panel) => (
          <PanelRenderer
            key={panel.id}
            dataSources={dataSources}
            panel={{
              ...panel,
              query: { ...panel.query, timeRange: activeRange },
            }}
            selected={selectedPanelId === panel.id}
            onSelect={() => onSelectPanel(panel.id)}
            theme={theme}
          />
        ))}
        {dashboard.panels.length === 0 ? (
          <article className="mt-card mt-span-12 do-empty-state">
            <h2>No real panels configured</h2>
            <p>Connect a real data source, define metrics, then add ChartSpec panels.</p>
          </article>
        ) : null}
      </section>
    </>
  );
}
