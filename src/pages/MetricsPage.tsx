import type { DataSource, MetricDefinition } from "../domain/types";

type MetricsPageProps = {
  metrics: MetricDefinition[];
  dataSources: DataSource[];
};

export function MetricsPage({ metrics, dataSources }: MetricsPageProps) {
  return (
    <section className="mt-grid">
      <article className="mt-card mt-span-12">
        <div className="mt-card-header">
          <div>
            <h2 className="mt-card-title">Semantic Metrics</h2>
            <p className="mt-card-subtitle">Metrics normalize raw source fields into reusable business and ops concepts.</p>
          </div>
          <button className="mt-button" data-variant="primary" type="button">
            New metric
          </button>
        </div>
        {metrics.length === 0 ? (
          <div className="do-empty-state do-table-empty">
            <h2>No real metrics</h2>
            <p>Metrics will be created after real source fields are available.</p>
          </div>
        ) : (
          <table className="mt-table">
            <thead>
              <tr>
                <th>Metric</th>
                <th>Source</th>
                <th>Field</th>
                <th>Aggregation</th>
                <th>Format</th>
                <th>Dimensions</th>
              </tr>
            </thead>
            <tbody>
              {metrics.map((metric) => {
                const source = dataSources.find((item) => item.id === metric.dataSourceId);
                return (
                  <tr key={metric.id}>
                    <td>
                      <strong>{metric.name}</strong>
                      <div className="do-table-subtext">{metric.key}</div>
                    </td>
                    <td>{source?.name ?? metric.dataSourceId}</td>
                    <td>{metric.field}</td>
                    <td>{metric.aggregation}</td>
                    <td>{metric.format}</td>
                    <td>{metric.dimensions.join(", ") || "none"}</td>
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
