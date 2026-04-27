import { useState } from "react";
import { apiClient } from "../api/client";
import type { DataSource } from "../domain/types";
import { queryEngine } from "../services/queryEngine";

type DataSourcesPageProps = {
  dataSources: DataSource[];
};

export function DataSourcesPage({ dataSources }: DataSourcesPageProps) {
  const [testResults, setTestResults] = useState<Record<string, string>>({});

  async function testSource(source: DataSource) {
    setTestResults((current) => ({ ...current, [source.id]: "Testing..." }));
    if (source.kind === "zhupay") {
      const status = await apiClient.getZhupayStatus();
      setTestResults((current) => ({
        ...current,
        [source.id]: status.configured
          ? `Zhupay configured · ${status.orderCount} orders cached`
          : "Zhupay credentials are not configured",
      }));
      return;
    }

    if (source.kind === "creem") {
      const status = await apiClient.getCreemStatus();
      setTestResults((current) => ({
        ...current,
        [source.id]: status.configured
          ? `Creem ${status.mode} configured · ${status.transactionCount} transactions cached`
          : "Creem API key is not configured",
      }));
      return;
    }

    if (source.kind === "manual") {
      const status = await apiClient.getManualRevenueStatus();
      setTestResults((current) => ({
        ...current,
        [source.id]: `Manual entry source ready · ${status.entryCount} entries`,
      }));
      return;
    }

    const result = await queryEngine.testDataSource(source);
    setTestResults((current) => ({
      ...current,
      [source.id]: `${result.message} (${result.latencyMs}ms)`,
    }));
  }

  return (
    <section className="mt-grid">
      <article className="mt-card mt-span-12">
        <div className="mt-card-header">
          <div>
            <h2 className="mt-card-title">Data Sources</h2>
            <p className="mt-card-subtitle">Connect APIs, databases, metrics systems, webhooks, and SaaS tools.</p>
          </div>
          <button className="mt-button" data-variant="primary" type="button">
            Add source
          </button>
        </div>
        <div className="do-source-grid">
          {dataSources.length === 0 ? (
            <div className="do-empty-state do-source-empty">
              <h2>No real data sources</h2>
              <p>Waiting for a real API, database, webhook, or metrics system to be connected.</p>
            </div>
          ) : null}
          {dataSources.map((source) => (
            <div className="do-source-tile" key={source.id}>
              <div className="do-source-header">
                <div>
                  <h3>{source.name}</h3>
                  <p>{source.description}</p>
                </div>
                <span className="mt-badge" data-intent={source.status === "live" ? "positive" : undefined}>
                  {source.status}
                </span>
              </div>
              <dl className="do-definition-list">
                <div>
                  <dt>Kind</dt>
                  <dd>{source.kind}</dd>
                </div>
                <div>
                  <dt>Auth</dt>
                  <dd>{source.auth}</dd>
                </div>
                <div>
                  <dt>Refresh</dt>
                  <dd>{source.refreshIntervalMs / 1000}s</dd>
                </div>
                <div>
                  <dt>Fields</dt>
                  <dd>{source.fields.length}</dd>
                </div>
              </dl>
              <div className="do-source-footer">
                <code>{source.endpoint}</code>
                <button className="mt-button" onClick={() => void testSource(source)} type="button">
                  Test
                </button>
              </div>
              {testResults[source.id] ? <p className="do-test-result">{testResults[source.id]}</p> : null}
            </div>
          ))}
        </div>
      </article>
    </section>
  );
}
