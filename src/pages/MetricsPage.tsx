import type { DataSource, MetricDefinition } from "../domain/types";
import { useI18n } from "../lib/i18n";

type MetricsPageProps = {
  metrics: MetricDefinition[];
  dataSources: DataSource[];
};

export function MetricsPage({ metrics, dataSources }: MetricsPageProps) {
  const { t, tx, te } = useI18n();
  return (
    <section className="mt-grid">
      <article className="mt-card mt-span-12">
        <div className="mt-card-header">
          <div>
            <h2 className="mt-card-title">{t("metrics.title")}</h2>
            <p className="mt-card-subtitle">{t("metrics.subtitle")}</p>
          </div>
          <button className="mt-button" data-variant="primary" type="button">
            {t("metrics.new")}
          </button>
        </div>
        {metrics.length === 0 ? (
          <div className="do-empty-state do-table-empty">
            <h2>{t("metrics.emptyTitle")}</h2>
            <p>{t("metrics.emptyText")}</p>
          </div>
        ) : (
          <table className="mt-table">
            <thead>
              <tr>
                <th>{t("metrics.metric")}</th>
                <th>{t("metrics.source")}</th>
                <th>{t("metrics.field")}</th>
                <th>{t("metrics.aggregation")}</th>
                <th>{t("metrics.format")}</th>
                <th>{t("metrics.dimensions")}</th>
              </tr>
            </thead>
            <tbody>
              {metrics.map((metric) => {
                const source = dataSources.find((item) => item.id === metric.dataSourceId);
                return (
                  <tr key={metric.id}>
                    <td>
                      <strong>{tx(metric.name)}</strong>
                      <div className="do-table-subtext">{metric.key}</div>
                    </td>
                    <td>{tx(source?.name) || metric.dataSourceId}</td>
                    <td>{tx(metric.field)}</td>
                    <td>{te("aggregation", metric.aggregation)}</td>
                    <td>{te("format", metric.format)}</td>
                    <td>{metric.dimensions.map((dimension) => tx(dimension)).join(", ") || t("common.none")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </article>
    </section>
  );
}
