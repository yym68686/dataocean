export type ThemeMode = "light" | "dark";

export type AppSection =
  | "command"
  | "dashboards"
  | "provider-zhupay"
  | "provider-creem"
  | "datasources"
  | "metrics"
  | "alerts"
  | "templates"
  | "admin-users"
  | "settings";

export type DataSourceKind =
  | "custom-api"
  | "postgres"
  | "prometheus"
  | "stripe"
  | "zhupay"
  | "creem"
  | "aggregate"
  | "webhook"
  | "csv";

export type DataSourceStatus = "live" | "synced" | "polling" | "error" | "draft";

export type MetricFormat = "currency" | "percent" | "number" | "duration" | "bytes";

export type MetricAggregation = "sum" | "avg" | "count" | "p50" | "p95" | "latest";

export type PanelRenderer =
  | "lightweight-timeseries"
  | "kpi"
  | "table"
  | "status-card"
  | "signal-list";

export type TimeRange = "1h" | "1d" | "1w" | "1m" | "all";

export interface DataSource {
  id: string;
  name: string;
  kind: DataSourceKind;
  status: DataSourceStatus;
  description: string;
  endpoint: string;
  auth: "none" | "api-key" | "bearer" | "basic" | "oauth" | "rsa";
  refreshIntervalMs: number;
  lastSyncAt: string;
  owner: string;
  fields: DataField[];
}

export interface DataField {
  key: string;
  label: string;
  type: "string" | "number" | "time" | "boolean";
  sample?: string | number | boolean;
}

export interface MetricDefinition {
  id: string;
  key: string;
  name: string;
  description: string;
  dataSourceId: string;
  field: string;
  timeField: string;
  aggregation: MetricAggregation;
  format: MetricFormat;
  unit?: string;
  dimensions: string[];
}

export interface ChartQuerySpec {
  dataSourceId: string;
  metric: string;
  timeRange: TimeRange;
  refreshIntervalMs: number;
  dimensions?: string[];
  filters?: Record<string, string | number | boolean>;
}

export interface ChartEncoding {
  x?: string;
  y?: string;
  color?: string;
  label?: string;
  value?: string;
}

export interface ChartStyle {
  theme?: ThemeMode | "system";
  seriesStyle?: "line" | "area" | "step" | "bar";
  colorIntent?: "primary" | "positive" | "negative" | "neutral";
  compact?: boolean;
}

export interface ChartInteractions {
  tooltip?: boolean;
  crosshair?: boolean;
  zoom?: boolean;
  rangeSwitcher?: boolean;
  linkedFilters?: boolean;
}

export interface ChartSpec {
  id: string;
  title: string;
  renderer: PanelRenderer;
  query: ChartQuerySpec;
  encoding: ChartEncoding;
  style?: ChartStyle;
  interactions?: ChartInteractions;
  layout: PanelLayout;
  description?: string;
}

export interface PanelLayout {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Dashboard {
  id: string;
  name: string;
  description: string;
  teamId: string;
  defaultTimeRange: TimeRange;
  refreshIntervalMs: number;
  panels: ChartSpec[];
}

export interface QueryColumn {
  key: string;
  label: string;
  type: "string" | "number" | "time" | "boolean";
  format?: MetricFormat;
  unit?: string;
}

export interface QueryRow {
  [key: string]: string | number | boolean;
}

export interface QueryResult {
  columns: QueryColumn[];
  rows: QueryRow[];
  meta: {
    metric: MetricDefinition;
    dataSource: DataSource;
    unit?: string;
    freshness: "live" | "cached" | "stale";
    generatedAt: string;
    previousValue?: number;
    warnings?: string[];
  };
}

export interface AlertRule {
  id: string;
  name: string;
  metricKey: string;
  condition: string;
  severity: "info" | "warning" | "critical";
  status: "enabled" | "disabled";
  lastTriggeredAt?: string;
}

export interface DashboardTemplate {
  id: string;
  name: string;
  category: "Revenue" | "DevOps" | "SaaS" | "AI" | "Ecommerce";
  description: string;
  panels: number;
}

export interface ConnectorTestResult {
  ok: boolean;
  latencyMs: number;
  message: string;
}

export interface AppData {
  dataSources: DataSource[];
  metrics: MetricDefinition[];
  dashboard: Dashboard;
  dashboards?: Dashboard[];
  alerts: AlertRule[];
  templates: DashboardTemplate[];
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: "admin" | "member";
  apiKeyPrefix: string;
  apiKeyScope: "admin" | "user";
  createdAt: string;
  updatedAt: string;
}
