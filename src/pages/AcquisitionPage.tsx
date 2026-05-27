import { useEffect, useMemo, useState } from "react";
import { apiClient } from "../api/client";
import type { AcquisitionSummaryResponse, AnalyticsProjectSummary, AnalyticsStatusResponse } from "../domain/types";
import { useI18n } from "../lib/i18n";

type LoadState =
  | { status: "loading" }
  | { status: "ready"; analytics: AnalyticsStatusResponse; acquisition: AcquisitionSummaryResponse }
  | { status: "error"; message: string };

type AcquisitionViewProps = {
  projectId?: string;
};

const rangeOptions = [
  { id: "7d", days: 7, label: "7D" },
  { id: "30d", days: 30, label: "30D" },
  { id: "90d", days: 90, label: "90D" },
] as const;

type RangeId = (typeof rangeOptions)[number]["id"];

export function AcquisitionView({ projectId }: AcquisitionViewProps = {}) {
  const { t } = useI18n();
  const [rangeId, setRangeId] = useState<RangeId>("30d");
  const [state, setState] = useState<LoadState>({ status: "loading" });

  const selectedRange = rangeOptions.find((item) => item.id === rangeId) ?? rangeOptions[1];

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setState({ status: "loading" });
      try {
        const to = new Date();
        const from = new Date(to.getTime() - selectedRange.days * 24 * 60 * 60 * 1000);
        const analytics = await apiClient.getAnalyticsStatus();
        const effectiveProjectId = projectId ?? analytics.defaultProjectId;
        const acquisition = await apiClient.getAcquisitionSummary({
          projectId: effectiveProjectId,
          from: from.toISOString(),
          to: to.toISOString(),
          limit: 20,
        });
        if (!cancelled) {
          setState({ status: "ready", analytics, acquisition });
        }
      } catch (error) {
        if (!cancelled) {
          setState({
            status: "error",
            message: error instanceof Error ? error.message : t("acquisition.loadError"),
          });
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [projectId, selectedRange.days, t]);

  if (state.status === "loading") {
    return (
      <section className="mt-grid">
        <article className="mt-card mt-span-12 do-empty-state">
          <h2>{t("acquisition.loadingTitle")}</h2>
          <p>{t("acquisition.loadingText")}</p>
        </article>
      </section>
    );
  }

  if (state.status === "error") {
    return (
      <section className="mt-grid">
        <article className="mt-card mt-span-12 do-empty-state">
          <h2>{t("common.error")}</h2>
          <p>{state.message}</p>
        </article>
      </section>
    );
  }

  const { analytics, acquisition } = state;
  const project = analytics.projects.find((item) => item.id === acquisition.project.id);

  return (
    <section className="mt-grid">
      <article className="mt-card mt-span-12">
        <div className="mt-card-header">
          <div>
            <h2 className="mt-card-title">{t("acquisition.title")}</h2>
            <p className="mt-card-subtitle">{t("acquisition.subtitle")}</p>
          </div>
          <div className="mt-segmented" role="group" aria-label={t("dashboard.timeRange")}>
            {rangeOptions.map((range) => (
              <button
                className="mt-segment"
                data-active={rangeId === range.id}
                key={range.id}
                onClick={() => setRangeId(range.id)}
                type="button"
              >
                {range.label}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-card-body do-acquisition-project">
          <ProjectHealth project={project} />
        </div>
      </article>

      <KpiCard label={t("acquisition.kpi.visitors")} value={formatInteger(acquisition.kpis.visitors)} />
      <KpiCard label={t("acquisition.kpi.landingViews")} value={formatInteger(acquisition.kpis.landingViews)} />
      <KpiCard label={t("acquisition.kpi.signupStarted")} value={formatInteger(acquisition.kpis.signupStarted)} />
      <KpiCard label={t("acquisition.kpi.signups")} value={formatInteger(acquisition.kpis.signups)} />
      <KpiCard label={t("acquisition.kpi.conversion")} value={formatPercent(acquisition.kpis.conversionRate)} />
      <KpiCard label={t("acquisition.kpi.sessions")} value={formatInteger(acquisition.kpis.sessions)} />

      <article className="mt-card mt-span-6">
        <div className="mt-card-header">
          <div>
            <h2 className="mt-card-title">{t("acquisition.sources")}</h2>
            <p className="mt-card-subtitle">{t("acquisition.sourcesSubtitle")}</p>
          </div>
        </div>
        <div className="mt-card-body">
          {acquisition.sources.length > 0 ? (
            <div className="do-table-scroll">
              <table className="mt-table">
                <thead>
                  <tr>
                    <th>{t("acquisition.source")}</th>
                    <th>{t("acquisition.landing")}</th>
                    <th>{t("acquisition.started")}</th>
                    <th>{t("acquisition.signups")}</th>
                    <th>{t("acquisition.conversion")}</th>
                  </tr>
                </thead>
                <tbody>
                  {acquisition.sources.map((source) => (
                    <tr key={source.source}>
                      <td>
                        <strong>{source.source}</strong>
                      </td>
                      <td>{formatInteger(source.landingViews)}</td>
                      <td>{formatInteger(source.signupStarted)}</td>
                      <td>{formatInteger(source.signups)}</td>
                      <td>{formatPercent(source.conversionRate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="do-empty-state do-table-empty">
              <h2>{t("acquisition.emptyTitle")}</h2>
              <p>{t("acquisition.emptyText")}</p>
            </div>
          )}
        </div>
      </article>

      <article className="mt-card mt-span-6">
        <div className="mt-card-header">
          <div>
            <h2 className="mt-card-title">{t("acquisition.trend")}</h2>
            <p className="mt-card-subtitle">{t("acquisition.trendSubtitle")}</p>
          </div>
        </div>
        <div className="mt-card-body">
          <AcquisitionBars data={acquisition.series} />
        </div>
      </article>

      <article className="mt-card mt-span-12">
        <div className="mt-card-header">
          <div>
            <h2 className="mt-card-title">{t("acquisition.recentEvents")}</h2>
            <p className="mt-card-subtitle">{t("acquisition.recentEventsSubtitle")}</p>
          </div>
        </div>
        <div className="mt-card-body">
          {acquisition.recentEvents.length > 0 ? (
            <div className="do-table-scroll">
              <table className="mt-table">
                <thead>
                  <tr>
                    <th>{t("acquisition.event")}</th>
                    <th>{t("acquisition.source")}</th>
                    <th>{t("acquisition.path")}</th>
                    <th>{t("acquisition.actor")}</th>
                    <th>{t("acquisition.time")}</th>
                  </tr>
                </thead>
                <tbody>
                  {acquisition.recentEvents.map((event) => (
                    <tr key={event.eventId}>
                      <td>
                        <strong>{event.name}</strong>
                        <div className="do-table-subtext">{event.eventId}</div>
                      </td>
                      <td>{event.source}</td>
                      <td>{event.path ?? "-"}</td>
                      <td>{event.userId ?? event.anonymousId ?? "-"}</td>
                      <td>{formatTime(event.occurredAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="do-empty-state do-table-empty">
              <h2>{t("acquisition.emptyTitle")}</h2>
              <p>{t("acquisition.emptyText")}</p>
            </div>
          )}
        </div>
      </article>
    </section>
  );
}

export function AcquisitionPage() {
  return <AcquisitionView />;
}

function ProjectHealth({ project }: { project?: AnalyticsProjectSummary }) {
  const { t } = useI18n();
  if (!project) {
    return <span className="do-muted">{t("acquisition.noProject")}</span>;
  }
  const publicKey = project.keys.find((key) => key.scope === "public");
  const serverKey = project.keys.find((key) => key.scope === "server");
  return (
    <>
      <div className="do-query-chip">
        <span className="do-query-label">{t("acquisition.project")}</span>
        <strong>{project.name}</strong>
      </div>
      <div className="do-query-chip">
        <span className="do-query-label">{t("acquisition.events")}</span>
        <strong>{formatInteger(project.eventCount)}</strong>
      </div>
      <div className="do-query-chip">
        <span className="do-query-label">{t("acquisition.publicKey")}</span>
        <strong>{publicKey?.prefix ?? "-"}</strong>
      </div>
      <div className="do-query-chip">
        <span className="do-query-label">{t("acquisition.serverKey")}</span>
        <strong>{serverKey?.prefix ?? "-"}</strong>
      </div>
      <div className="do-query-chip">
        <span className="do-query-label">{t("acquisition.lastEvent")}</span>
        <strong>{formatTime(project.lastEventAt)}</strong>
      </div>
    </>
  );
}

function KpiCard({ label, value }: { label: string; value: string }) {
  return (
    <article className="mt-card mt-span-4 do-acquisition-kpi">
      <div className="mt-kpi-label">{label}</div>
      <div className="mt-kpi-value">{value}</div>
    </article>
  );
}

function AcquisitionBars({ data }: { data: AcquisitionSummaryResponse["series"] }) {
  const { t } = useI18n();
  const maxValue = useMemo(
    () => Math.max(1, ...data.map((point) => Math.max(point.landingViews, point.signupStarted, point.signups))),
    [data],
  );

  if (data.length === 0) {
    return (
      <div className="do-empty-state do-table-empty">
        <h2>{t("acquisition.emptyTitle")}</h2>
        <p>{t("acquisition.emptyText")}</p>
      </div>
    );
  }

  return (
    <div className="do-acquisition-bars">
      {data.slice(-14).map((point) => (
        <div className="do-acquisition-bar-row" key={point.ts}>
          <div className="do-acquisition-bar-label">{formatShortDay(point.ts)}</div>
          <div className="do-acquisition-bar-track" title={`${point.landingViews} / ${point.signups}`}>
            <span style={{ width: `${Math.max(2, (point.landingViews / maxValue) * 100)}%` }} />
            <strong style={{ width: `${Math.max(2, (point.signups / maxValue) * 100)}%` }} />
          </div>
          <div className="do-acquisition-bar-value">{point.signups}</div>
        </div>
      ))}
    </div>
  );
}

function formatInteger(value: number) {
  return new Intl.NumberFormat().format(value);
}

function formatPercent(value: number | null) {
  if (value === null) {
    return "-";
  }
  return `${(value * 100).toFixed(1)}%`;
}

function formatTime(value?: string | null) {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return "-";
  }
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatShortDay(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return "-";
  }
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "2-digit" }).format(date);
}
