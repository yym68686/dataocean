import type { Dashboard, DataSource, MetricDefinition, ThemeMode, TimeRange } from "../domain/types";
import { PanelRenderer } from "../components/panels/PanelRenderer";
import { useI18n } from "../lib/i18n";

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
  const { t, tx } = useI18n();
  const activeSources = dataSources.filter((source) => ["live", "polling", "synced"].includes(source.status)).length;

  return (
    <>
      <section className="do-query-strip" aria-label={t("dashboard.summary")}>
        <div className="do-query-chip">
          <span className="do-query-label">{t("dashboard.dashboard")}</span>
          <strong>{tx(dashboard.name)}</strong>
        </div>
        <div className="do-query-chip">
          <span className="do-query-label">{t("dashboard.timeRange")}</span>
          <strong>{activeRange.toUpperCase()}</strong>
        </div>
        <div className="do-query-chip">
          <span className="do-query-label">{t("dashboard.activeSources")}</span>
          <strong>{activeSources} / {dataSources.length}</strong>
        </div>
        <div className="do-query-chip">
          <span className="do-query-label">{t("dashboard.semanticMetrics")}</span>
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
            <h2>{t("dashboard.noPanels")}</h2>
            <p>{t("dashboard.noPanelsText")}</p>
          </article>
        ) : null}
      </section>
    </>
  );
}
