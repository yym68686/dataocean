import type {
  ChartQuerySpec,
  ConnectorTestResult,
  DataSource,
  MetricDefinition,
  QueryResult,
  QueryRow,
  TimeRange,
} from "../domain/types";

export interface DataConnector {
  testConnection(dataSource: DataSource): Promise<ConnectorTestResult>;
  discoverSchema(dataSource: DataSource): Promise<DataSource["fields"]>;
  executeQuery(args: {
    dataSource: DataSource;
    metric: MetricDefinition;
    query: ChartQuerySpec;
  }): Promise<QueryResult>;
}

const rangePoints: Record<TimeRange, number> = {
  "1h": 60,
  "1d": 96,
  "1w": 168,
  "1m": 180,
  all: 240,
};

const rangeStepSeconds: Record<TimeRange, number> = {
  "1h": 60,
  "1d": 15 * 60,
  "1w": 60 * 60,
  "1m": 4 * 60 * 60,
  all: 24 * 60 * 60,
};

class MockConnector implements DataConnector {
  async testConnection(dataSource: DataSource): Promise<ConnectorTestResult> {
    await delay(120);

    return {
      ok: dataSource.status !== "error",
      latencyMs: 42 + deterministicNumber(dataSource.id, 86),
      message: dataSource.status === "error" ? "Connector returned an error" : "Connection healthy",
    };
  }

  async discoverSchema(dataSource: DataSource): Promise<DataSource["fields"]> {
    await delay(80);
    return dataSource.fields;
  }

  async executeQuery({
    dataSource,
    metric,
    query,
  }: {
    dataSource: DataSource;
    metric: MetricDefinition;
    query: ChartQuerySpec;
  }): Promise<QueryResult> {
    await delay(120);

    const rows = createRows(metric, query.timeRange);
    const latest = Number(rows[rows.length - 1]?.value ?? 0);
    const previous = Number(rows[Math.max(0, rows.length - 16)]?.value ?? latest);

    return {
      columns: [
        { key: "timestamp", label: "Timestamp", type: "time" },
        { key: "value", label: metric.name, type: "number", format: metric.format },
      ],
      rows,
      meta: {
        metric,
        dataSource,
        unit: metric.unit,
        freshness: dataSource.status === "live" ? "live" : "cached",
        generatedAt: new Date().toISOString(),
        previousValue: previous,
      },
    };
  }
}

export const connectorRegistry: Record<string, DataConnector> = {
  "custom-api": new MockConnector(),
  postgres: new MockConnector(),
  prometheus: new MockConnector(),
  stripe: new MockConnector(),
  webhook: new MockConnector(),
  csv: new MockConnector(),
};

function createRows(metric: MetricDefinition, timeRange: TimeRange): QueryRow[] {
  const pointCount = rangePoints[timeRange];
  const step = rangeStepSeconds[timeRange];
  const nowSeconds = Math.floor(Date.now() / 1000);
  const startSeconds = nowSeconds - pointCount * step;
  const seed = deterministicNumber(metric.key, 1000);

  return Array.from({ length: pointCount }, (_, index) => {
    const timestamp = startSeconds + index * step;
    const value = valueForMetric(metric, index, pointCount, seed);
    return { timestamp, value };
  });
}

function valueForMetric(metric: MetricDefinition, index: number, total: number, seed: number) {
  const t = index / Math.max(1, total - 1);
  const wave = Math.sin(index / 5.7 + seed) * 0.055 + Math.cos(index / 13.2) * 0.028;
  const step = index > total * 0.64 ? 0.05 : 0;

  switch (metric.key) {
    case "gross_revenue":
      return Math.round(62000 + t * 68400 + wave * 48000 + step * 120000);
    case "order_count":
      return Math.round(3100 + t * 5200 + wave * 1900);
    case "conversion_rate":
      return clamp(0.046 + t * 0.022 + wave * 0.22, 0.02, 0.12);
    case "api_latency_p95":
      return Math.round(72 + Math.abs(wave) * 420 + (index % 31 === 0 ? 45 : 0));
    case "error_rate":
      return clamp(0.0012 + Math.abs(wave) * 0.01 + (index > total * 0.72 ? 0.0008 : 0), 0.0001, 0.009);
    case "service_health_score":
      return clamp(0.84 + t * 0.08 - Math.abs(wave) * 0.42, 0.58, 0.99);
    case "active_users":
      return Math.round(16000 + t * 2400 + wave * 5200);
    default:
      return clamp(0.5 + t * 0.28 + wave + step, 0.05, 0.99);
  }
}

function deterministicNumber(value: string, modulo: number) {
  return Array.from(value).reduce((acc, char) => acc + char.charCodeAt(0), 0) % modulo;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
