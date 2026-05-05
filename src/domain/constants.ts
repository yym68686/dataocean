import type { AppSection, TimeRange } from "./types";

export const timeRanges: Array<{ label: string; value: TimeRange }> = [
  { label: "1H", value: "1h" },
  { label: "1D", value: "1d" },
  { label: "1W", value: "1w" },
  { label: "1M", value: "1m" },
  { label: "ALL", value: "all" },
];

export const sectionLabels: Record<AppSection, string> = {
  command: "Command Center",
  dashboards: "Dashboards",
  "provider-zhupay": "Zhupay",
  "provider-creem": "Creem",
  "provider-sub2api": "Sub2API",
  "provider-nl2pcb": "NL2PCB",
  "provider-manual": "Manual Revenue",
  datasources: "Data Sources",
  metrics: "Metrics",
  alerts: "Alerts",
  templates: "Templates",
  "admin-users": "Users",
  settings: "Settings",
};
