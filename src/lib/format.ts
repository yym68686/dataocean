import type { MetricFormat } from "../domain/types";

export function formatMetricValue(value: number, format?: MetricFormat, unit?: string) {
  switch (format) {
    case "currency":
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: unit === "USD" || !unit ? "USD" : unit,
        notation: Math.abs(value) >= 100000 ? "compact" : "standard",
        maximumFractionDigits: Math.abs(value) >= 1000 ? 1 : 0,
      }).format(value);
    case "percent":
      return `${(value * 100).toFixed(value < 0.01 ? 2 : 1)}%`;
    case "duration":
      return `${Math.round(value)}${unit ?? "ms"}`;
    case "bytes":
      return formatBytes(value);
    case "number":
    default:
      return new Intl.NumberFormat("en-US", {
        notation: Math.abs(value) >= 100000 ? "compact" : "standard",
        maximumFractionDigits: 1,
      }).format(value);
  }
}

export function formatDelta(current: number, previous?: number, format?: MetricFormat) {
  if (previous === undefined || previous === 0) {
    return { label: "live", intent: "neutral" as const };
  }

  const delta = current - previous;
  const deltaRatio = delta / Math.abs(previous);
  const positiveIsGood = format !== "duration";
  const isPositive = positiveIsGood ? delta >= 0 : delta <= 0;

  return {
    label: `${deltaRatio >= 0 ? "+" : ""}${(deltaRatio * 100).toFixed(1)}%`,
    intent: isPositive ? ("positive" as const) : ("negative" as const),
  };
}

export function formatDateTime(value: string | number) {
  const date = typeof value === "number" ? new Date(value * 1000) : new Date(value);
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatBytes(value: number) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}
