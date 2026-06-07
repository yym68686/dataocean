import { useEffect, useMemo, useState } from "react";
import { apiClient } from "../api/client";
import { timeRanges } from "../domain/constants";
import type { Dashboard, DataSource, MetricDefinition, ThemeMode, TimeRange } from "../domain/types";
import { formatDateTime, formatMetricValue } from "../lib/format";
import { useDisplayCurrency } from "../lib/displayCurrency";
import { useI18n } from "../lib/i18n";
import { queryEngine } from "../services/queryEngine";
import { AcquisitionView } from "./AcquisitionPage";
import { DashboardPage } from "./DashboardPage";
import { ManualRevenuePage } from "./ManualRevenuePage";

type DataSourcesPageProps = {
  dataSources: DataSource[];
  metrics: MetricDefinition[];
  dashboards: Dashboard[];
  theme: ThemeMode;
};

type SourceTabId = "overview" | "acquisition" | "records" | "dashboard" | "fields" | "metrics";

type SourceTab = {
  id: SourceTabId;
  labelKey: string;
};

export function DataSourcesPage({ dataSources, metrics, dashboards, theme }: DataSourcesPageProps) {
  const { intlLocale, t, tx, te } = useI18n();
  const { currencyFormatOptions } = useDisplayCurrency();
  const [selectedSourceId, setSelectedSourceId] = useState(() => getDefaultSourceId(dataSources));
  const [selectedTabId, setSelectedTabId] = useState<SourceTabId>("overview");
  const [testResults, setTestResults] = useState<Record<string, string>>({});
  const [selectedDashboardId, setSelectedDashboardId] = useState("");
  const [selectedDashboardPanelId, setSelectedDashboardPanelId] = useState<string | undefined>();
  const [sourceDashboardRange, setSourceDashboardRange] = useState<TimeRange>("1m");

  useEffect(() => {
    if (dataSources.length === 0) {
      setSelectedSourceId("");
      return;
    }

    if (!dataSources.some((source) => source.id === selectedSourceId)) {
      setSelectedSourceId(getDefaultSourceId(dataSources));
    }
  }, [dataSources, selectedSourceId]);

  const selectedSource = useMemo(
    () => dataSources.find((source) => source.id === selectedSourceId) ?? dataSources.find((source) => source.id === getDefaultSourceId(dataSources)),
    [dataSources, selectedSourceId],
  );

  const sourceMetrics = useMemo(
    () => (selectedSource ? metrics.filter((metric) => metric.dataSourceId === selectedSource.id) : []),
    [metrics, selectedSource],
  );

  const sourceDashboards = useMemo(
    () => (selectedSource ? dashboards.filter((dashboard) => getDashboardSourceId(dashboard) === selectedSource.id) : []),
    [dashboards, selectedSource],
  );

  const sourceTabs = useMemo(() => buildSourceTabs(selectedSource, sourceDashboards.length > 0), [selectedSource, sourceDashboards.length]);
  const selectedDashboard = sourceDashboards.find((dashboard) => dashboard.id === selectedDashboardId) ?? sourceDashboards[0];
  const relatedDashboardIds = sourceDashboards.map((dashboard) => dashboard.id).join("|");

  useEffect(() => {
    if (sourceTabs.length > 0 && !sourceTabs.some((tab) => tab.id === selectedTabId)) {
      setSelectedTabId(sourceTabs[0].id);
    }
  }, [selectedTabId, sourceTabs]);

  useEffect(() => {
    if (!sourceDashboards.some((dashboard) => dashboard.id === selectedDashboardId)) {
      setSelectedDashboardId(sourceDashboards[0]?.id ?? "");
    }
  }, [relatedDashboardIds, selectedDashboardId, sourceDashboards]);

  useEffect(() => {
    if (!selectedDashboard) {
      setSelectedDashboardPanelId(undefined);
      return;
    }

    setSourceDashboardRange(selectedDashboard.defaultTimeRange);
    setSelectedDashboardPanelId(selectedDashboard.panels[0]?.id);
  }, [selectedDashboard?.id]);

  async function testSource(source: DataSource) {
    setTestResults((current) => ({ ...current, [source.id]: t("common.testing") }));
    try {
      if (source.kind === "zhupay") {
        const status = await apiClient.getZhupayStatus();
        setTestResults((current) => ({
          ...current,
          [source.id]: status.configured
            ? t("datasources.zhupayConfigured", { count: status.orderCount })
            : t("datasources.zhupayMissing"),
        }));
        return;
      }

      if (source.kind === "yizhifu") {
        const status = await apiClient.getYizhifuStatus();
        setTestResults((current) => ({
          ...current,
          [source.id]: status.configured
            ? t("datasources.yizhifuConfigured", { count: status.orderCount })
            : t("datasources.yizhifuMissing"),
        }));
        return;
      }

      if (source.kind === "analytics") {
        const status = await apiClient.getAnalyticsStatus();
        const project = status.projects.find((item) => item.id === source.id);
        setTestResults((current) => ({
          ...current,
          [source.id]: project
            ? t("datasources.analyticsConfigured", {
                project: project.name,
                count: project.eventCount,
                last: project.lastEventAt ? project.lastEventAt.slice(0, 19).replace("T", " ") : t("common.never"),
              })
            : t("datasources.analyticsMissing"),
        }));
        return;
      }

      if (source.kind === "creem") {
        const status = await apiClient.getCreemStatus();
        setTestResults((current) => ({
          ...current,
          [source.id]: status.configured
            ? t("datasources.creemConfigured", { mode: status.mode, count: status.transactionCount })
            : t("datasources.creemMissing"),
        }));
        return;
      }

      if (source.kind === "manual") {
        const status = await apiClient.getManualRevenueStatus();
        setTestResults((current) => ({
          ...current,
          [source.id]: t("datasources.manualReady", { count: status.entryCount }),
        }));
        return;
      }

      if (source.kind === "sub2api") {
        const status = await apiClient.getSub2ApiStatus();
        setTestResults((current) => ({
          ...current,
          [source.id]: status.configured
            ? t("datasources.sub2apiConfigured", {
                count: status.channelCount ?? status.channels.length,
                profit: formatMetricValue(status.totalProfit ?? 0, "currency", status.currency, intlLocale, currencyFormatOptions),
              })
            : t("datasources.sub2apiMissing"),
        }));
        return;
      }

      if (source.kind === "nl2pcb") {
        const status = await apiClient.getNl2PcbStatus();
        setTestResults((current) => ({
          ...current,
          [source.id]: status.configured
            ? t("datasources.nl2pcbConfigured", {
                users: status.userCount,
                jobs: status.jobCount,
                feedback: status.feedbackCount,
              })
            : t("datasources.nl2pcbMissing"),
        }));
        return;
      }

      const result = await queryEngine.testDataSource(source);
      setTestResults((current) => ({
        ...current,
        [source.id]: `${result.message} (${result.latencyMs}ms)`,
      }));
    } catch (error) {
      setTestResults((current) => ({
        ...current,
        [source.id]: error instanceof Error ? error.message : t("common.error"),
      }));
    }
  }

  return (
    <section className="do-source-workspace">
      <aside className="mt-card do-source-list-panel">
        <div className="do-source-list-header">
          <h2>{t("datasources.workspaceTitle")}</h2>
          <p>{t("datasources.workspaceSubtitle")}</p>
        </div>
        <div className="do-source-list" role="list">
          {dataSources.length === 0 ? (
            <div className="do-empty-state do-source-empty">
              <h2>{t("datasources.emptyTitle")}</h2>
              <p>{t("datasources.emptyText")}</p>
            </div>
          ) : null}
          {dataSources.map((source) => (
            <button
              className="do-source-list-item"
              data-active={selectedSource?.id === source.id}
              key={source.id}
              onClick={() => setSelectedSourceId(source.id)}
              type="button"
            >
              <span className="do-source-list-item-header">
                <strong>{tx(source.name)}</strong>
                <span className="mt-badge" data-intent={source.status === "live" ? "positive" : undefined}>
                  {te("status", source.status)}
                </span>
              </span>
              <span className="do-source-list-description">{tx(source.description)}</span>
              <span className="do-source-list-meta">
                <span>{te("kind", source.kind)}</span>
                <span>{tx(source.owner)}</span>
              </span>
            </button>
          ))}
        </div>
      </aside>

      {selectedSource ? (
        <div className="do-source-detail">
          <div className="do-source-detail-header">
            <div>
              <div className="do-live-line">
                <span className="do-live-pill">{te("status", selectedSource.status)}</span>
                <span>{te("kind", selectedSource.kind)}</span>
              </div>
              <h2>{tx(selectedSource.name)}</h2>
              <p>{tx(selectedSource.description)}</p>
            </div>
            <div className="do-source-detail-actions">
              <button className="mt-button" data-variant="primary" type="button">
                {t("datasources.add")}
              </button>
              <button className="mt-button" onClick={() => void testSource(selectedSource)} type="button">
                {t("common.test")}
              </button>
            </div>
          </div>

          <div className="mt-segmented do-source-tabs" role="tablist" aria-label={t("datasources.tabs")}>
            {sourceTabs.map((tab) => (
              <button
                aria-selected={selectedTabId === tab.id}
                className="mt-segment"
                data-active={selectedTabId === tab.id}
                key={tab.id}
                onClick={() => setSelectedTabId(tab.id)}
                role="tab"
                type="button"
              >
                {t(tab.labelKey)}
              </button>
            ))}
          </div>

          <div className="do-source-tab-content" role="tabpanel">
            {selectedTabId === "overview" ? (
              <SourceOverview
                metricsCount={sourceMetrics.length}
                source={selectedSource}
                testResult={testResults[selectedSource.id]}
              />
            ) : null}
            {selectedTabId === "fields" ? <SourceFields source={selectedSource} /> : null}
            {selectedTabId === "metrics" ? <SourceMetrics metrics={sourceMetrics} /> : null}
            {selectedTabId === "dashboard" ? (
              <SourceDashboardTab
                activeRange={sourceDashboardRange}
                dashboard={selectedDashboard}
                dashboards={sourceDashboards}
                dataSources={dataSources}
                metrics={metrics}
                onDashboardChange={setSelectedDashboardId}
                onRangeChange={setSourceDashboardRange}
                onSelectPanel={setSelectedDashboardPanelId}
                selectedDashboardId={selectedDashboard?.id}
                selectedPanelId={selectedDashboardPanelId}
                theme={theme}
              />
            ) : null}
            {selectedTabId === "acquisition" ? <AcquisitionView projectId={selectedSource.id} /> : null}
            {selectedTabId === "records" ? <ManualRevenuePage /> : null}
          </div>
        </div>
      ) : (
        <div className="mt-card do-empty-state do-source-empty-detail">
          <h2>{t("datasources.noSource")}</h2>
          <p>{t("datasources.emptyText")}</p>
        </div>
      )}
    </section>
  );
}

function SourceOverview({ source, metricsCount, testResult }: { source: DataSource; metricsCount: number; testResult?: string }) {
  const { intlLocale, t, tx, te } = useI18n();
  const lastSync = source.lastSyncAt ? formatDateTime(source.lastSyncAt, intlLocale) : t("common.never");

  return (
    <section className="mt-grid">
      <article className="mt-card mt-span-12">
        <div className="mt-card-header">
          <div>
            <h2 className="mt-card-title">{t("datasources.overview")}</h2>
            <p className="mt-card-subtitle">{t("datasources.selectedSubtitle")}</p>
          </div>
        </div>
        <div className="do-source-chip-grid">
          <SourceChip label={t("datasources.kind")} value={te("kind", source.kind)} />
          <SourceChip label={t("datasources.auth")} value={te("auth", source.auth)} />
          <SourceChip label={t("datasources.refresh")} value={`${source.refreshIntervalMs / 1000}s`} />
          <SourceChip label={t("datasources.owner")} value={tx(source.owner)} />
          <SourceChip label={t("datasources.fields")} value={String(source.fields.length)} />
          <SourceChip label={t("metrics.title")} value={String(metricsCount)} />
          <SourceChip label={t("datasources.lastSync")} value={lastSync} />
          <SourceChip label={t("datasources.endpoint")} value={source.endpoint} mono />
        </div>
        {testResult ? <p className="do-test-result do-source-test-result">{testResult}</p> : null}
      </article>
    </section>
  );
}

function SourceFields({ source }: { source: DataSource }) {
  const { t, tx } = useI18n();

  return (
    <section className="mt-grid">
      <article className="mt-card mt-span-12">
        <div className="mt-card-header">
          <div>
            <h2 className="mt-card-title">{t("datasources.fields")}</h2>
            <p className="mt-card-subtitle">{t("datasources.fieldsSubtitle")}</p>
          </div>
        </div>
        {source.fields.length === 0 ? (
          <div className="do-empty-state do-table-empty">
            <h2>{t("datasources.noFields")}</h2>
            <p>{t("datasources.emptyText")}</p>
          </div>
        ) : (
          <div className="do-table-scroll">
            <table className="mt-table">
              <thead>
                <tr>
                  <th>{t("metrics.field")}</th>
                  <th>{t("datasources.fieldsLabel")}</th>
                  <th>{t("datasources.type")}</th>
                  <th>{t("datasources.sample")}</th>
                </tr>
              </thead>
              <tbody>
                {source.fields.map((field) => (
                  <tr key={field.key}>
                    <td>
                      <strong>{field.key}</strong>
                    </td>
                    <td>{tx(field.label)}</td>
                    <td>{field.type}</td>
                    <td>{field.sample === undefined ? "--" : String(field.sample)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </article>
    </section>
  );
}

function SourceMetrics({ metrics }: { metrics: MetricDefinition[] }) {
  const { t, tx, te } = useI18n();

  return (
    <section className="mt-grid">
      <article className="mt-card mt-span-12">
        <div className="mt-card-header">
          <div>
            <h2 className="mt-card-title">{t("metrics.title")}</h2>
            <p className="mt-card-subtitle">{t("datasources.metricsSubtitle")}</p>
          </div>
        </div>
        {metrics.length === 0 ? (
          <div className="do-empty-state do-table-empty">
            <h2>{t("datasources.noMetrics")}</h2>
            <p>{t("metrics.emptyText")}</p>
          </div>
        ) : (
          <div className="do-table-scroll">
            <table className="mt-table">
              <thead>
                <tr>
                  <th>{t("metrics.metric")}</th>
                  <th>{t("metrics.field")}</th>
                  <th>{t("metrics.aggregation")}</th>
                  <th>{t("metrics.format")}</th>
                  <th>{t("metrics.dimensions")}</th>
                </tr>
              </thead>
              <tbody>
                {metrics.map((metric) => (
                  <tr key={metric.id}>
                    <td>
                      <strong>{tx(metric.name)}</strong>
                      <div className="do-table-subtext">{metric.key}</div>
                    </td>
                    <td>{tx(metric.field)}</td>
                    <td>{te("aggregation", metric.aggregation)}</td>
                    <td>{te("format", metric.format)}</td>
                    <td>{metric.dimensions.map((dimension) => tx(dimension)).join(", ") || t("common.none")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </article>
    </section>
  );
}

function SourceDashboardTab({
  activeRange,
  dashboard,
  dashboards,
  dataSources,
  metrics,
  onDashboardChange,
  onRangeChange,
  onSelectPanel,
  selectedDashboardId,
  selectedPanelId,
  theme,
}: {
  activeRange: TimeRange;
  dashboard?: Dashboard;
  dashboards: Dashboard[];
  dataSources: DataSource[];
  metrics: MetricDefinition[];
  onDashboardChange: (dashboardId: string) => void;
  onRangeChange: (range: TimeRange) => void;
  onSelectPanel: (panelId: string) => void;
  selectedDashboardId?: string;
  selectedPanelId?: string;
  theme: ThemeMode;
}) {
  const { t, tx } = useI18n();

  if (!dashboard) {
    return (
      <article className="mt-card mt-span-12 do-empty-state">
        <h2>{t("datasources.noDashboards")}</h2>
        <p>{t("dashboard.noPanelsText")}</p>
      </article>
    );
  }

  return (
    <div className="do-source-dashboard-stack">
      <div className="do-source-dashboard-toolbar">
        {dashboards.length > 1 ? (
          <div className="mt-segmented" role="group" aria-label={t("dashboard.dashboard")}>
            {dashboards.map((item) => (
              <button
                className="mt-segment"
                data-active={selectedDashboardId === item.id}
                key={item.id}
                onClick={() => onDashboardChange(item.id)}
                type="button"
              >
                {tx(item.name)}
              </button>
            ))}
          </div>
        ) : null}
        <div className="mt-segmented" role="group" aria-label={t("dashboard.timeRange")}>
          {timeRanges.map((range) => (
            <button
              className="mt-segment"
              data-active={activeRange === range.value}
              key={range.value}
              onClick={() => onRangeChange(range.value)}
              type="button"
            >
              {range.label}
            </button>
          ))}
        </div>
      </div>
      <DashboardPage
        activeRange={activeRange}
        dashboard={dashboard}
        dataSources={dataSources}
        metrics={metrics}
        onSelectPanel={onSelectPanel}
        selectedPanelId={selectedPanelId}
        theme={theme}
      />
    </div>
  );
}

function SourceChip({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="do-query-chip">
      <span className="do-query-label">{label}</span>
      <strong>{mono ? <code>{value}</code> : value}</strong>
    </div>
  );
}

function buildSourceTabs(source: DataSource | undefined, hasDashboard: boolean): SourceTab[] {
  if (!source) {
    return [];
  }

  const tabs: SourceTab[] = [{ id: "overview", labelKey: "datasources.overview" }];

  if (source.kind === "analytics") {
    tabs.push({ id: "acquisition", labelKey: "datasources.acquisitionTab" });
  }

  if (source.kind === "manual") {
    tabs.push({ id: "records", labelKey: "datasources.recordsTab" });
  }

  if (hasDashboard) {
    tabs.push({ id: "dashboard", labelKey: "datasources.dashboardTab" });
  }

  tabs.push(
    { id: "fields", labelKey: "datasources.fieldsTab" },
    { id: "metrics", labelKey: "datasources.metricsTab" },
  );

  return tabs;
}

function getDashboardSourceId(dashboard: Dashboard) {
  if (dashboard.dataSourceId) {
    return dashboard.dataSourceId;
  }

  const sourceIds = new Set(dashboard.panels.map((panel) => panel.query.dataSourceId).filter(Boolean));
  return sourceIds.size === 1 ? Array.from(sourceIds)[0] : undefined;
}

function getDefaultSourceId(sources: DataSource[]) {
  return sources.find((source) => source.id === "uni-api-web")?.id
    ?? sources.find((source) => source.kind !== "aggregate")?.id
    ?? sources[0]?.id
    ?? "";
}
