import type { AlertRule } from "../domain/types";
import { formatDateTime } from "../lib/format";
import { useI18n } from "../lib/i18n";

type AlertsPageProps = {
  alerts: AlertRule[];
};

export function AlertsPage({ alerts }: AlertsPageProps) {
  const { intlLocale, t, te } = useI18n();
  return (
    <section className="mt-grid">
      <article className="mt-card mt-span-12">
        <div className="mt-card-header">
          <div>
            <h2 className="mt-card-title">{t("alerts.title")}</h2>
            <p className="mt-card-subtitle">{t("alerts.subtitle")}</p>
          </div>
          <button className="mt-button" data-variant="primary" type="button">
            {t("alerts.new")}
          </button>
        </div>
        {alerts.length === 0 ? (
          <div className="do-empty-state do-table-empty">
            <h2>{t("alerts.emptyTitle")}</h2>
            <p>{t("alerts.emptyText")}</p>
          </div>
        ) : (
          <table className="mt-table">
            <thead>
              <tr>
                <th>{t("alerts.name")}</th>
                <th>{t("alerts.metric")}</th>
                <th>{t("alerts.condition")}</th>
                <th>{t("alerts.severity")}</th>
                <th>{t("alerts.status")}</th>
                <th>{t("alerts.lastTriggered")}</th>
              </tr>
            </thead>
            <tbody>
              {alerts.map((alert) => (
                <tr key={alert.id}>
                  <td>{alert.name}</td>
                  <td>{alert.metricKey}</td>
                  <td>{alert.condition}</td>
                  <td>
                    <span className="mt-badge" data-intent={alert.severity === "critical" ? "negative" : undefined}>
                      {te("severity", alert.severity)}
                    </span>
                  </td>
                  <td>{te("status", alert.status)}</td>
                  <td>{alert.lastTriggeredAt ? formatDateTime(alert.lastTriggeredAt, intlLocale) : t("common.never")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </article>
    </section>
  );
}
