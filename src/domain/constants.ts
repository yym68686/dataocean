import type { TimeRange } from "./types";

export const timeRanges: Array<{ label: string; value: TimeRange }> = [
  { label: "1H", value: "1h" },
  { label: "1D", value: "1d" },
  { label: "1W", value: "1w" },
  { label: "1M", value: "1m" },
  { label: "ALL", value: "all" },
];

export const sectionLabels = {
  command: "Command Center",
  dashboards: "Dashboards",
  datasources: "Data Sources",
  metrics: "Metrics",
  alerts: "Alerts",
  templates: "Templates",
  settings: "Settings",
} as const;
