import type { AppData, AuthUser, ChartSpec, ManualRevenueEntry, QueryResult } from "../domain/types";

const TOKEN_STORAGE_KEY = "dataocean-session-token";

export type AuthResponse = {
  user: AuthUser;
  token: string;
  expiresAt: string;
  apiKey?: string;
};

export function getStoredToken() {
  return window.localStorage.getItem(TOKEN_STORAGE_KEY);
}

export function setStoredToken(token: string) {
  window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
}

export function clearStoredToken() {
  window.localStorage.removeItem(TOKEN_STORAGE_KEY);
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getStoredToken();
  const headers = new Headers(options.headers);

  if (!headers.has("Content-Type") && options.body) {
    headers.set("Content-Type", "application/json");
  }
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(path, {
    ...options,
    headers,
  });

  if (!response.ok) {
    let message = `Request failed with ${response.status}`;
    try {
      const payload = await response.json();
      message = payload.error?.message ?? message;
    } catch {
      message = response.statusText || message;
    }
    throw new Error(message);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

export const apiClient = {
  async register(input: { email: string; password: string; name?: string }) {
    return request<AuthResponse>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },

  async login(input: { email: string; password: string }) {
    return request<AuthResponse>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },

  async logout() {
    return request<void>("/api/auth/logout", { method: "POST" });
  },

  async me() {
    return request<{ user: AuthUser; authType: string }>("/api/auth/me");
  },

  async rotateApiKey() {
    return request<{ user: AuthUser; apiKey: string }>("/api/auth/api-key/rotate", {
      method: "POST",
    });
  },

  async listAdminUsers() {
    return request<{ users: AuthUser[] }>("/api/admin/users");
  },

  async deleteAdminUser(userId: string) {
    return request<{ user: AuthUser }>(`/api/admin/users/${encodeURIComponent(userId)}`, {
      method: "DELETE",
    });
  },

  async getState() {
    return request<AppData>("/api/state");
  },

  async getCurrencySettings() {
    return request<{
      reportingCurrency: string;
      supportedDisplayCurrencies: string[];
      defaultDisplayCurrency: string;
      rates: Record<string, Record<string, number>>;
    }>("/api/currency");
  },

  async executePanel(panel: ChartSpec) {
    return request<QueryResult>("/api/query/panel", {
      method: "POST",
      body: JSON.stringify(panel),
    });
  },

  async getZhupayStatus() {
    return request<{
      configured: boolean;
      pidConfigured: boolean;
      merchantPrivateKeyConfigured: boolean;
      platformPublicKeyConfigured: boolean;
      orderCount: number;
      lastSnapshotAt?: string | null;
      lastOrderAt?: string | null;
    }>("/api/connectors/zhupay/status");
  },

  async getCreemStatus() {
    return request<{
      configured: boolean;
      webhookConfigured: boolean;
      apiKeyConfigured: boolean;
      mode: string;
      currency: string;
      transactionCount: number;
      customerCount: number;
      subscriptionCount: number;
      lastSnapshotAt?: string | null;
      lastTransactionAt?: string | null;
    }>("/api/connectors/creem/status");
  },

  async getManualRevenueStatus() {
    return request<{
      configured: boolean;
      reportingCurrency: string;
      entryCount: number;
      totalRevenue: number;
      todayRevenue: number;
      warnings: string[];
      lastReceivedAt?: string | null;
    }>("/api/connectors/manual-revenue/status");
  },

  async getSub2ApiStatus() {
    return request<{
      configured: boolean;
      baseUrl: string;
      channels: string[];
      profitRate: number;
      currency: string;
      totalCost?: number;
      totalProfit?: number;
      todayCost?: number;
      todayProfit?: number;
      requestCount?: number;
      channelCount?: number;
      lastError?: string | null;
    }>("/api/connectors/sub2api/status");
  },

  async getNl2PcbStatus() {
    return request<{
      configured: boolean;
      baseUrl: string;
      syncLimit: number;
      userCount: number;
      activeUserCount: number;
      disabledUserCount: number;
      jobCount: number;
      todayJobCount: number;
      feedbackCount: number;
      lastSnapshotAt?: string | null;
      lastUserAt?: string | null;
      lastJobAt?: string | null;
      lastFeedbackAt?: string | null;
    }>("/api/connectors/nl2pcb/status");
  },

  async listManualRevenueEntries(input: { limit?: number } = {}) {
    const params = new URLSearchParams();
    if (input.limit) {
      params.set("limit", String(input.limit));
    }
    const suffix = params.toString() ? `?${params.toString()}` : "";
    return request<{ entries: ManualRevenueEntry[] }>(`/api/connectors/manual-revenue/entries${suffix}`);
  },

  async createManualRevenueEntry(input: {
    channel: string;
    amount: number;
    currency: string;
    note?: string;
    receivedAt?: string;
  }) {
    return request<{ entry: ManualRevenueEntry }>("/api/connectors/manual-revenue/entries", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },

  async updateManualRevenueEntry(
    id: string,
    input: Partial<{
      channel: string;
      amount: number;
      currency: string;
      note: string;
      receivedAt: string;
    }>,
  ) {
    return request<{ entry: ManualRevenueEntry }>(`/api/connectors/manual-revenue/entries/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
  },

  async deleteManualRevenueEntry(id: string) {
    return request<{ entry: { id: string } }>(`/api/connectors/manual-revenue/entries/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  },

  async syncZhupay(input: { maxPages?: number; limit?: number } = {}) {
    return request<{ ok: boolean; syncedOrders: number; merchantInfo: unknown }>("/api/connectors/zhupay/sync", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },

  async syncCreem(input: { maxPages?: number; pageSize?: number } = {}) {
    return request<{
      ok: boolean;
      syncedTransactions: number;
      syncedCustomers: number;
      syncedSubscriptions: number;
    }>("/api/connectors/creem/sync", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },

  async syncSub2Api() {
    return request<{
      ok: boolean;
      summary: unknown;
    }>("/api/connectors/sub2api/sync", {
      method: "POST",
    });
  },

  async syncNl2Pcb(input: { limit?: number } = {}) {
    return request<{
      ok: boolean;
      syncedUsers: number;
      syncedJobs: number;
      syncedFeedback: number;
    }>("/api/connectors/nl2pcb/sync", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
};
