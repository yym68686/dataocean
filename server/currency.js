const DEFAULT_REPORTING_CURRENCY = "USD";
const USD_STABLECOINS = new Set(["USDC", "USDT"]);

export function getReportingCurrency() {
  return (process.env.DATAOCEAN_REPORTING_CURRENCY || process.env.CREEM_CURRENCY || DEFAULT_REPORTING_CURRENCY).toUpperCase();
}

export function getFxRate(fromCurrency, toCurrency) {
  const from = normalizeCurrency(fromCurrency || toCurrency);
  const to = normalizeCurrency(toCurrency);
  if (from === to) {
    return 1;
  }
  if (to === "USD" && USD_STABLECOINS.has(from)) {
    return 1;
  }
  if (from === "USD" && USD_STABLECOINS.has(to)) {
    return 1;
  }

  const key = `DATAOCEAN_FX_${from}_TO_${to}`;
  const value = Number(process.env[key]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function normalizeCurrency(value) {
  return String(value || DEFAULT_REPORTING_CURRENCY).trim().toUpperCase();
}

export function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}
