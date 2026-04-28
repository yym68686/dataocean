import { type FormEvent, useEffect, useMemo, useState } from "react";
import { apiClient } from "../api/client";
import type { ManualRevenueEntry } from "../domain/types";
import { formatDateTime, formatMetricValue, type CurrencyFormatOptions } from "../lib/format";
import { useDisplayCurrency } from "../lib/displayCurrency";
import { useI18n } from "../lib/i18n";

type ManualRevenueStatus = {
  configured: boolean;
  reportingCurrency: string;
  entryCount: number;
  totalRevenue: number;
  todayRevenue: number;
  warnings: string[];
  lastReceivedAt?: string | null;
};

type ManualRevenueForm = {
  channel: string;
  amount: string;
  currency: string;
  receivedAt: string;
  note: string;
};

type ManualRevenueCache = {
  status: ManualRevenueStatus;
  entries: ManualRevenueEntry[];
  fetchedAt: number;
};

const MANUAL_REVENUE_CACHE_TTL_MS = 60_000;
let manualRevenueCache: ManualRevenueCache | null = null;
let manualRevenuePromise: Promise<ManualRevenueCache> | null = null;

const emptyForm = (): ManualRevenueForm => ({
  channel: "WeChat Pay",
  amount: "",
  currency: "CNY",
  receivedAt: toDateTimeLocal(new Date().toISOString()),
  note: "",
});

export function ManualRevenuePage() {
  const { intlLocale, t } = useI18n();
  const { currencyFormatOptions } = useDisplayCurrency();
  const [entries, setEntries] = useState<ManualRevenueEntry[]>([]);
  const [status, setStatus] = useState<ManualRevenueStatus | null>(null);
  const [form, setForm] = useState<ManualRevenueForm>(() => emptyForm());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const channelOptions = useMemo(
    () => Array.from(new Set(["WeChat Pay", "Alipay", "USDT", "Crypto", "Bank Transfer", "Cash", ...entries.map((entry) => entry.channel)])),
    [entries],
  );

  useEffect(() => {
    void loadManualRevenue({ preferCache: true });
  }, []);

  async function loadManualRevenue({ force = false, preferCache = false }: { force?: boolean; preferCache?: boolean } = {}) {
    const cached = getFreshManualRevenueCache();
    if (!force && cached) {
      setStatus(cached.status);
      setEntries(cached.entries);
      setLoading(false);
      setError("");
      return;
    }

    if (preferCache && manualRevenueCache) {
      setStatus(manualRevenueCache.status);
      setEntries(manualRevenueCache.entries);
      setLoading(false);
    } else {
      setLoading(true);
    }
    setError("");
    try {
      const next = await fetchManualRevenue(force);
      setStatus(next.status);
      setEntries(next.entries);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t("manual.loadError"));
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setMessage("");

    try {
      const payload = {
        channel: form.channel.trim(),
        amount: Number(form.amount),
        currency: form.currency.trim().toUpperCase(),
        receivedAt: form.receivedAt ? new Date(form.receivedAt).toISOString() : undefined,
        note: form.note.trim(),
      };

      if (editingId) {
        await apiClient.updateManualRevenueEntry(editingId, payload);
        setMessage(t("manual.entryUpdated"));
      } else {
        await apiClient.createManualRevenueEntry(payload);
        setMessage(t("manual.entryAdded"));
      }

      setEditingId(null);
      setForm(emptyForm());
      await loadManualRevenue({ force: true });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t("manual.saveError"));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(entry: ManualRevenueEntry) {
    const confirmed = window.confirm(t("manual.confirmDelete", {
      entry: `${entry.channel} ${formatRawAmount(entry, intlLocale, currencyFormatOptions)}`,
    }));
    if (!confirmed) {
      return;
    }

    setError("");
    setMessage("");
    try {
      await apiClient.deleteManualRevenueEntry(entry.id);
      setMessage(t("manual.entryDeleted"));
      await loadManualRevenue({ force: true });
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : t("manual.deleteError"));
    }
  }

  function startEditing(entry: ManualRevenueEntry) {
    setEditingId(entry.id);
    setForm({
      channel: entry.channel,
      amount: String(entry.amount),
      currency: entry.currency,
      receivedAt: toDateTimeLocal(entry.receivedAt),
      note: entry.note ?? "",
    });
    setMessage("");
    setError("");
  }

  function cancelEditing() {
    setEditingId(null);
    setForm(emptyForm());
  }

  return (
    <section className="mt-grid">
      <article className="mt-card mt-span-12">
        <div className="mt-card-header">
          <div>
            <h2 className="mt-card-title">{t("manual.title")}</h2>
            <p className="mt-card-subtitle">{t("manual.subtitle")}</p>
          </div>
          <span className="mt-badge" data-intent="positive">
            {t("common.live")}
          </span>
        </div>

        <div className="do-admin-stats">
          <div>
            <span>{t("manual.today")}</span>
            <strong>
              {formatMetricValue(status?.todayRevenue ?? 0, "currency", status?.reportingCurrency ?? "USD", intlLocale, currencyFormatOptions)}
            </strong>
          </div>
          <div>
            <span>{t("manual.total")}</span>
            <strong>
              {formatMetricValue(status?.totalRevenue ?? 0, "currency", status?.reportingCurrency ?? "USD", intlLocale, currencyFormatOptions)}
            </strong>
          </div>
          <div>
            <span>{t("manual.entries")}</span>
            <strong>{status?.entryCount ?? entries.length}</strong>
          </div>
        </div>

        {status?.warnings.length ? <div className="do-auth-error do-admin-message">{status.warnings.join(" ")}</div> : null}
        {error ? <div className="do-auth-error do-admin-message">{error}</div> : null}
        {message ? <div className="do-admin-success do-admin-message">{message}</div> : null}

        <form className="do-manual-form" onSubmit={(event) => void handleSubmit(event)}>
          <label>
            <span>{t("manual.amount")}</span>
            <input
              min="0"
              required
              step="0.00000001"
              type="number"
              value={form.amount}
              onChange={(event) => setForm((current) => ({ ...current, amount: event.target.value }))}
            />
          </label>
          <label>
            <span>{t("manual.currency")}</span>
            <input
              maxLength={12}
              required
              value={form.currency}
              onChange={(event) => setForm((current) => ({ ...current, currency: event.target.value.toUpperCase() }))}
            />
          </label>
          <label>
            <span>{t("manual.channel")}</span>
            <input
              list="manual-revenue-channels"
              maxLength={80}
              required
              value={form.channel}
              onChange={(event) => setForm((current) => ({ ...current, channel: event.target.value }))}
            />
            <datalist id="manual-revenue-channels">
              {channelOptions.map((channel) => (
                <option key={channel} value={channel} />
              ))}
            </datalist>
          </label>
          <label>
            <span>{t("manual.receivedAt")}</span>
            <input
              required
              type="datetime-local"
              value={form.receivedAt}
              onChange={(event) => setForm((current) => ({ ...current, receivedAt: event.target.value }))}
            />
          </label>
          <label className="do-manual-note">
            <span>{t("manual.note")}</span>
            <textarea
              rows={3}
              value={form.note}
              onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))}
            />
          </label>
          <div className="do-manual-actions">
            {editingId ? (
              <button className="mt-button" onClick={cancelEditing} type="button">
                {t("common.cancel")}
              </button>
            ) : null}
            <button className="mt-button" data-variant="primary" disabled={saving} type="submit">
              {saving ? t("manual.saving") : editingId ? t("manual.saveEntry") : t("manual.addEntry")}
            </button>
          </div>
        </form>
      </article>

      <article className="mt-card mt-span-12">
        <div className="mt-card-header">
          <div>
            <h2 className="mt-card-title">{t("manual.entries")}</h2>
            <p className="mt-card-subtitle">
              {status?.lastReceivedAt ? t("manual.lastReceived", { time: formatDateTime(status.lastReceivedAt, intlLocale) }) : t("manual.records")}
            </p>
          </div>
          <button className="mt-button" onClick={() => void loadManualRevenue({ force: true })} type="button">
            {t("common.refresh")}
          </button>
        </div>

        {loading ? (
          <div className="do-empty-state do-table-empty">
            <h2>{t("manual.loadingTitle")}</h2>
            <p>{t("manual.loadingText")}</p>
          </div>
        ) : entries.length === 0 ? (
          <div className="do-empty-state do-table-empty">
            <h2>{t("manual.emptyTitle")}</h2>
            <p>{t("manual.emptyText")}</p>
          </div>
        ) : (
          <div className="do-table-scroll">
            <table className="mt-table">
              <thead>
                <tr>
                  <th>{t("manual.received")}</th>
                  <th>{t("manual.channel")}</th>
                  <th>{t("manual.amount")}</th>
                  <th>{t("manual.note")}</th>
                  <th>{t("manual.createdBy")}</th>
                  <th>{t("common.action")}</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id}>
                    <td>{formatDateTime(entry.receivedAt, intlLocale)}</td>
                    <td>{entry.channel}</td>
                    <td>
                      <strong>{formatRawAmount(entry, intlLocale, currencyFormatOptions)}</strong>
                    </td>
                    <td>{entry.note || "--"}</td>
                    <td>{entry.createdByName ?? entry.createdByEmail ?? "--"}</td>
                    <td>
                      <div className="do-row-actions">
                        <button className="mt-button" onClick={() => startEditing(entry)} type="button">
                          {t("common.edit")}
                        </button>
                        <button className="mt-button" data-variant="danger" onClick={() => void handleDelete(entry)} type="button">
                          {t("common.delete")}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </article>
    </section>
  );
}

export function clearManualRevenuePageCache() {
  manualRevenueCache = null;
  manualRevenuePromise = null;
}

function getFreshManualRevenueCache() {
  if (!manualRevenueCache) {
    return null;
  }

  return Date.now() - manualRevenueCache.fetchedAt < MANUAL_REVENUE_CACHE_TTL_MS ? manualRevenueCache : null;
}

async function fetchManualRevenue(force: boolean) {
  if (!force && manualRevenuePromise) {
    return manualRevenuePromise;
  }

  manualRevenuePromise = Promise.all([
    apiClient.getManualRevenueStatus(),
    apiClient.listManualRevenueEntries({ limit: 100 }),
  ])
    .then(([statusResult, entriesResult]) => {
      manualRevenueCache = {
        status: statusResult,
        entries: entriesResult.entries,
        fetchedAt: Date.now(),
      };
      return manualRevenueCache;
    })
    .finally(() => {
      manualRevenuePromise = null;
    });

  return manualRevenuePromise;
}

function toDateTimeLocal(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const offsetMs = date.getTimezoneOffset() * 60 * 1000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function formatRawAmount(entry: ManualRevenueEntry, locale: string, currencyFormatOptions: CurrencyFormatOptions) {
  return formatMetricValue(entry.amount, "currency", entry.currency, locale, currencyFormatOptions);
}
