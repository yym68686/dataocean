import { dataSources, metrics } from "../data/seed";
import type { Dashboard, TimeRange } from "../domain/types";
import { PanelRenderer } from "../components/panels/PanelRenderer";

type DashboardPageProps = {
  dashboard: Dashboard;
  activeRange: TimeRange;
  selectedPanelId?: string;
  onSelectPanel: (panelId: string) => void;
};

export function DashboardPage({ dashboard, activeRange, selectedPanelId, onSelectPanel }: DashboardPageProps) {
  const liveSources = dataSources.filter((source) => source.status === "live").length;

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
          <span className="do-query-label">Live Sources</span>
          <strong>{liveSources} / {dataSources.length}</strong>
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
            panel={{
              ...panel,
              query: { ...panel.query, timeRange: activeRange },
            }}
            selected={selectedPanelId === panel.id}
            onSelect={() => onSelectPanel(panel.id)}
          />
        ))}
      </section>
    </>
  );
}
