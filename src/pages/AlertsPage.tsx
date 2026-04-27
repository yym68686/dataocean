import type { AlertRule } from "../domain/types";

type AlertsPageProps = {
  alerts: AlertRule[];
};

export function AlertsPage({ alerts }: AlertsPageProps) {
  return (
    <section className="mt-grid">
      <article className="mt-card mt-span-12">
        <div className="mt-card-header">
          <div>
            <h2 className="mt-card-title">Alerts</h2>
            <p className="mt-card-subtitle">Rules turn metric state into decisions, notifications, and incident context.</p>
          </div>
          <button className="mt-button" data-variant="primary" type="button">
            New alert
          </button>
        </div>
        {alerts.length === 0 ? (
          <div className="do-empty-state do-table-empty">
            <h2>No real alerts</h2>
            <p>Alert rules will be added after real metrics exist.</p>
          </div>
        ) : (
          <table className="mt-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Metric</th>
                <th>Condition</th>
                <th>Severity</th>
                <th>Status</th>
                <th>Last Triggered</th>
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
                      {alert.severity}
                    </span>
                  </td>
                  <td>{alert.status}</td>
                  <td>{alert.lastTriggeredAt ? new Date(alert.lastTriggeredAt).toLocaleString() : "Never"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </article>
    </section>
  );
}
