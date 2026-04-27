import { type FormEvent, useEffect, useMemo, useState } from "react";
import { apiClient } from "../api/client";
import type { ManualRevenueEntry } from "../domain/types";
import { formatMetricValue } from "../lib/format";

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

const emptyForm = (): ManualRevenueForm => ({
  channel: "WeChat Pay",
  amount: "",
  currency: "CNY",
  receivedAt: toDateTimeLocal(new Date().toISOString()),
  note: "",
});

export function ManualRevenuePage() {
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
    void loadManualRevenue();
  }, []);

  async function loadManualRevenue() {
    setLoading(true);
    setError("");
    try {
      const [statusResult, entriesResult] = await Promise.all([
        apiClient.getManualRevenueStatus(),
        apiClient.listManualRevenueEntries({ limit: 100 }),
      ]);
      setStatus(statusResult);
      setEntries(entriesResult.entries);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load manual revenue");
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
        setMessage("Entry updated.");
      } else {
        await apiClient.createManualRevenueEntry(payload);
        setMessage("Entry added.");
      }

      setEditingId(null);
      setForm(emptyForm());
      await loadManualRevenue();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save entry");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(entry: ManualRevenueEntry) {
    const confirmed = window.confirm(`Delete ${entry.channel} ${formatRawAmount(entry)}?`);
    if (!confirmed) {
      return;
    }

    setError("");
    setMessage("");
    try {
      await apiClient.deleteManualRevenueEntry(entry.id);
      setMessage("Entry deleted.");
      await loadManualRevenue();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Could not delete entry");
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
            <h2 className="mt-card-title">Manual Revenue</h2>
            <p className="mt-card-subtitle">Offline transfers, wallet payments, crypto receipts, and other manual income.</p>
          </div>
          <span className="mt-badge" data-intent="positive">
            live
          </span>
        </div>

        <div className="do-admin-stats">
          <div>
            <span>Today</span>
            <strong>{formatMetricValue(status?.todayRevenue ?? 0, "currency", status?.reportingCurrency ?? "USD")}</strong>
          </div>
          <div>
            <span>Total</span>
            <strong>{formatMetricValue(status?.totalRevenue ?? 0, "currency", status?.reportingCurrency ?? "USD")}</strong>
          </div>
          <div>
            <span>Entries</span>
            <strong>{status?.entryCount ?? entries.length}</strong>
          </div>
        </div>

        {status?.warnings.length ? <div className="do-auth-error do-admin-message">{status.warnings.join(" ")}</div> : null}
        {error ? <div className="do-auth-error do-admin-message">{error}</div> : null}
        {message ? <div className="do-admin-success do-admin-message">{message}</div> : null}

        <form className="do-manual-form" onSubmit={(event) => void handleSubmit(event)}>
          <label>
            <span>Amount</span>
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
            <span>Currency</span>
            <input
              maxLength={12}
              required
              value={form.currency}
              onChange={(event) => setForm((current) => ({ ...current, currency: event.target.value.toUpperCase() }))}
            />
          </label>
          <label>
            <span>Channel</span>
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
            <span>Received At</span>
            <input
              required
              type="datetime-local"
              value={form.receivedAt}
              onChange={(event) => setForm((current) => ({ ...current, receivedAt: event.target.value }))}
            />
          </label>
          <label className="do-manual-note">
            <span>Note</span>
            <textarea
              rows={3}
              value={form.note}
              onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))}
            />
          </label>
          <div className="do-manual-actions">
            {editingId ? (
              <button className="mt-button" onClick={cancelEditing} type="button">
                Cancel
              </button>
            ) : null}
            <button className="mt-button" data-variant="primary" disabled={saving} type="submit">
              {saving ? "Saving" : editingId ? "Save entry" : "Add entry"}
            </button>
          </div>
        </form>
      </article>

      <article className="mt-card mt-span-12">
        <div className="mt-card-header">
          <div>
            <h2 className="mt-card-title">Entries</h2>
            <p className="mt-card-subtitle">{status?.lastReceivedAt ? `Last received ${formatDate(status.lastReceivedAt)}` : "Manual records"}</p>
          </div>
          <button className="mt-button" onClick={() => void loadManualRevenue()} type="button">
            Refresh
          </button>
        </div>

        {loading ? (
          <div className="do-empty-state do-table-empty">
            <h2>Loading entries</h2>
            <p>Fetching manual revenue records.</p>
          </div>
        ) : entries.length === 0 ? (
          <div className="do-empty-state do-table-empty">
            <h2>No manual entries</h2>
            <p>Manual revenue records will appear after they are added.</p>
          </div>
        ) : (
          <div className="do-table-scroll">
            <table className="mt-table">
              <thead>
                <tr>
                  <th>Received</th>
                  <th>Channel</th>
                  <th>Amount</th>
                  <th>Note</th>
                  <th>Created By</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id}>
                    <td>{formatDate(entry.receivedAt)}</td>
                    <td>{entry.channel}</td>
                    <td>
                      <strong>{formatRawAmount(entry)}</strong>
                    </td>
                    <td>{entry.note || "--"}</td>
                    <td>{entry.createdByName ?? entry.createdByEmail ?? "--"}</td>
                    <td>
                      <div className="do-row-actions">
                        <button className="mt-button" onClick={() => startEditing(entry)} type="button">
                          Edit
                        </button>
                        <button className="mt-button" data-variant="danger" onClick={() => void handleDelete(entry)} type="button">
                          Delete
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

function toDateTimeLocal(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const offsetMs = date.getTimezoneOffset() * 60 * 1000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function formatRawAmount(entry: ManualRevenueEntry) {
  return `${trimDecimal(entry.amount)} ${entry.currency}`;
}

function trimDecimal(value: number) {
  return Number(value).toLocaleString("en-US", {
    maximumFractionDigits: 8,
  });
}

function formatDate(value: string) {
  return new Date(value).toLocaleString();
}
