import { dataSources, metrics } from "../data/seed";
import type { ChartSpec, ConnectorTestResult, DataSource, MetricDefinition, QueryResult } from "../domain/types";
import { connectorRegistry } from "./connectors";

let catalogDataSources = dataSources;
let catalogMetrics = metrics;

export class QueryEngine {
  private cache = new Map<string, { expiresAt: number; result: QueryResult }>();

  async executePanel(panel: ChartSpec): Promise<QueryResult> {
    const dataSource = getDataSource(panel.query.dataSourceId);
    const metric = getMetric(panel.query.metric);
    const cacheKey = JSON.stringify(panel.query);
    const cached = this.cache.get(cacheKey);

    if (cached && cached.expiresAt > Date.now()) {
      return {
        ...cached.result,
        meta: { ...cached.result.meta, freshness: "cached" },
      };
    }

    const connector = connectorRegistry[dataSource.kind];
    const result = await connector.executeQuery({ dataSource, metric, query: panel.query });

    this.cache.set(cacheKey, {
      expiresAt: Date.now() + Math.max(1500, panel.query.refreshIntervalMs / 2),
      result,
    });

    return result;
  }

  async testDataSource(dataSource: DataSource): Promise<ConnectorTestResult> {
    const connector = connectorRegistry[dataSource.kind];
    return connector.testConnection(dataSource);
  }
}

export const queryEngine = new QueryEngine();

export function setQueryCatalog(catalog: { dataSources: DataSource[]; metrics: MetricDefinition[] }) {
  catalogDataSources = catalog.dataSources;
  catalogMetrics = catalog.metrics;
}

export function getDataSource(id: string): DataSource {
  const dataSource = catalogDataSources.find((item) => item.id === id);
  if (!dataSource) {
    throw new Error(`Unknown data source: ${id}`);
  }
  return dataSource;
}

export function getMetric(key: string): MetricDefinition {
  const metric = catalogMetrics.find((item) => item.key === key || item.id === key);
  if (!metric) {
    throw new Error(`Unknown metric: ${key}`);
  }
  return metric;
}
