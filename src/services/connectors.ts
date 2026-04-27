import type {
  ChartQuerySpec,
  ConnectorTestResult,
  DataSource,
  MetricDefinition,
  QueryResult,
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

class UnconfiguredConnector implements DataConnector {
  async testConnection(): Promise<ConnectorTestResult> {
    return {
      ok: false,
      latencyMs: 0,
      message: "Real connector execution is not configured yet",
    };
  }

  async discoverSchema(dataSource: DataSource): Promise<DataSource["fields"]> {
    return dataSource.fields;
  }

  async executeQuery(): Promise<QueryResult> {
    throw new Error("Real connector execution is not configured yet");
  }
}

export const connectorRegistry: Record<string, DataConnector> = {
  "custom-api": new UnconfiguredConnector(),
  postgres: new UnconfiguredConnector(),
  prometheus: new UnconfiguredConnector(),
  stripe: new UnconfiguredConnector(),
  zhupay: new UnconfiguredConnector(),
  creem: new UnconfiguredConnector(),
  aggregate: new UnconfiguredConnector(),
  webhook: new UnconfiguredConnector(),
  csv: new UnconfiguredConnector(),
};
