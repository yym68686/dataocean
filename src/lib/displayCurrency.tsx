import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { apiClient, getStoredToken } from "../api/client";
import type { CurrencyFormatOptions, CurrencyRates } from "./format";

export type DisplayCurrencyCode = "USD" | "CNY";

type CurrencySettings = {
  reportingCurrency: string;
  supportedDisplayCurrencies: DisplayCurrencyCode[];
  defaultDisplayCurrency: DisplayCurrencyCode;
  rates: CurrencyRates;
};

type DisplayCurrencyContextValue = {
  displayCurrency: DisplayCurrencyCode;
  supportedDisplayCurrencies: DisplayCurrencyCode[];
  currencyFormatOptions: CurrencyFormatOptions;
  setDisplayCurrency: (currency: DisplayCurrencyCode) => void;
  toggleDisplayCurrency: () => void;
  refreshCurrencySettings: () => Promise<void>;
};

const DISPLAY_CURRENCY_STORAGE_KEY = "dataocean-display-currency";

const fallbackSettings: CurrencySettings = {
  reportingCurrency: "USD",
  supportedDisplayCurrencies: ["USD", "CNY"],
  defaultDisplayCurrency: "USD",
  rates: {
    USD: { USD: 1, CNY: 7.2 },
    CNY: { USD: 1 / 7.2, CNY: 1 },
  },
};

const DisplayCurrencyContext = createContext<DisplayCurrencyContextValue | null>(null);

export function DisplayCurrencyProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<CurrencySettings>(fallbackSettings);
  const [displayCurrency, setDisplayCurrencyState] = useState<DisplayCurrencyCode>(() => readInitialDisplayCurrency());

  useEffect(() => {
    window.localStorage.setItem(DISPLAY_CURRENCY_STORAGE_KEY, displayCurrency);
  }, [displayCurrency]);

  const refreshCurrencySettings = useCallback(async () => {
    if (!getStoredToken()) {
      return;
    }
    const next = await apiClient.getCurrencySettings();
    setSettings({
      reportingCurrency: next.reportingCurrency,
      supportedDisplayCurrencies: normalizeSupportedCurrencies(next.supportedDisplayCurrencies),
      defaultDisplayCurrency: normalizeDisplayCurrency(next.defaultDisplayCurrency),
      rates: next.rates,
    });
  }, []);

  const value = useMemo<DisplayCurrencyContextValue>(() => {
    const setDisplayCurrency = (currency: DisplayCurrencyCode) => {
      setDisplayCurrencyState(currency);
    };

    return {
      displayCurrency,
      supportedDisplayCurrencies: settings.supportedDisplayCurrencies,
      currencyFormatOptions: {
        displayCurrency,
        rates: settings.rates,
      },
      setDisplayCurrency,
      toggleDisplayCurrency: () => {
        setDisplayCurrencyState((current) => (current === "USD" ? "CNY" : "USD"));
      },
      refreshCurrencySettings,
    };
  }, [displayCurrency, refreshCurrencySettings, settings]);

  return <DisplayCurrencyContext.Provider value={value}>{children}</DisplayCurrencyContext.Provider>;
}

export function useDisplayCurrency() {
  const context = useContext(DisplayCurrencyContext);
  if (!context) {
    throw new Error("useDisplayCurrency must be used inside DisplayCurrencyProvider");
  }
  return context;
}

function readInitialDisplayCurrency(): DisplayCurrencyCode {
  return normalizeDisplayCurrency(window.localStorage.getItem(DISPLAY_CURRENCY_STORAGE_KEY));
}

function normalizeSupportedCurrencies(values: string[] = []): DisplayCurrencyCode[] {
  const currencies = values.map((value) => normalizeDisplayCurrency(value));
  return Array.from(new Set(currencies.length ? currencies : fallbackSettings.supportedDisplayCurrencies));
}

function normalizeDisplayCurrency(value?: string | null): DisplayCurrencyCode {
  return String(value).toUpperCase() === "CNY" ? "CNY" : "USD";
}
