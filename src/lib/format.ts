import type { MetricFormat } from "../domain/types";

export type CurrencyRates = Record<string, Record<string, number>>;

export type CurrencyFormatOptions = {
  displayCurrency?: string;
  rates?: CurrencyRates;
};

export function formatMetricValue(
  value: number,
  format?: MetricFormat,
  unit?: string,
  locale = "en-US",
  currencyOptions?: CurrencyFormatOptions,
) {
  switch (format) {
    case "currency": {
      const converted = convertCurrencyValue(value, unit, currencyOptions?.displayCurrency, currencyOptions?.rates);
      return new Intl.NumberFormat(locale, {
        style: "currency",
        currency: converted.unit,
        notation: Math.abs(converted.value) >= 100000 ? "compact" : "standard",
        maximumFractionDigits: Math.abs(converted.value) >= 1000 ? 1 : 0,
      }).format(converted.value);
    }
    case "percent":
      return `${(value * 100).toFixed(value < 0.01 ? 2 : 1)}%`;
    case "duration":
      return `${Math.round(value)}${unit ?? "ms"}`;
    case "bytes":
      return formatBytes(value);
    case "number":
    default:
      return new Intl.NumberFormat(locale, {
        notation: Math.abs(value) >= 100000 ? "compact" : "standard",
        maximumFractionDigits: 1,
      }).format(value);
  }
}

export function convertMetricValue(value: number, format?: MetricFormat, unit?: string, currencyOptions?: CurrencyFormatOptions) {
  if (format !== "currency") {
    return {
      value,
      unit,
    };
  }

  return convertCurrencyValue(value, unit, currencyOptions?.displayCurrency, currencyOptions?.rates);
}

export function convertCurrencyValue(value: number, unit?: string, displayCurrency?: string, rates?: CurrencyRates) {
  const from = normalizeCurrencyCode(unit) ?? "USD";
  const to = normalizeCurrencyCode(displayCurrency) ?? from;
  const rate = rates?.[from]?.[to];

  if (from === to) {
    return { value, unit: from };
  }
  if (!Number.isFinite(rate)) {
    return { value, unit: from };
  }

  return {
    value: value * Number(rate),
    unit: to,
  };
}

export function formatDelta(current: number, previous?: number, format?: MetricFormat, neutralLabel = "live") {
  if (previous === undefined || previous === 0) {
    return { label: neutralLabel, intent: "neutral" as const };
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

export function formatDateTime(value: string | number, locale = "en-US", options: Intl.DateTimeFormatOptions = {}) {
  const date = toDate(value);
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    ...options,
  }).format(date);
}

export function formatNumber(value: number, locale = "en-US", options: Intl.NumberFormatOptions = {}) {
  return new Intl.NumberFormat(locale, options).format(value);
}

function toDate(value: string | number) {
  if (typeof value === "number") {
    return new Date(value < 1_000_000_000_000 ? value * 1000 : value);
  }
  return new Date(value);
}

function isCurrencyCode(value?: string) {
  return Boolean(value && /^[A-Z]{3}$/.test(value));
}

function normalizeCurrencyCode(value?: string) {
  if (!isCurrencyCode(value)) {
    return undefined;
  }
  const currency = String(value).toUpperCase();
  if (currency === "USDT" || currency === "USDC") {
    return "USD";
  }
  return currency;
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
