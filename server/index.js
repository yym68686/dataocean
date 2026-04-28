import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getCurrencyDisplayConfig } from "./currency.js";
import { migrateDatabase, pool, waitForDatabase } from "./database.js";
import {
  getCreemStatus,
  getCreemSummary,
  handleCreemWebhook,
  listCreemTransactions,
  queryCreemMetric,
  startCreemScheduler,
  syncCreem,
} from "./creem.js";
import {
  createManualRevenueEntry,
  deleteManualRevenueEntry,
  getManualRevenueStatus,
  listManualRevenueEntries,
  queryManualRevenueMetric,
  updateManualRevenueEntry,
} from "./manualRevenue.js";
import { queryRevenueMetric } from "./revenue.js";
import {
  getSub2ApiStatus,
  querySub2ApiMetric,
  syncSub2Api,
} from "./sub2api.js";
import {
  createCollectionItem,
  createDashboardPanel,
  createSession,
  createUser,
  deleteCollectionItem,
  deleteDashboardPanel,
  deleteUser,
  findAuthBySecret,
  getAppState,
  listAuditLogs,
  listCollection,
  listUsers,
  loginUser,
  logoutSession,
  replaceAppState,
  rotateApiKey,
  updateCollectionItem,
  updateDashboardPanel,
} from "./store.js";
import {
  getZhupayStatus,
  getZhupaySummary,
  handleZhupayNotify,
  listZhupayOrders,
  queryZhupayMetric,
  startZhupayScheduler,
  syncZhupay,
} from "./zhupay.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, "..", "dist");
const port = Number(process.env.PORT ?? 80);

const app = express();

app.disable("x-powered-by");
app.use(express.json({
  limit: "2mb",
  verify: (req, _res, buffer) => {
    req.rawBody = buffer.toString("utf8");
  },
}));
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", process.env.CORS_ORIGIN ?? "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-API-Key");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  next();
});

const apiSpec = {
  auth: [
    "POST /api/auth/register",
    "POST /api/auth/login",
    "POST /api/auth/logout",
    "GET /api/auth/me",
    "POST /api/auth/api-key/rotate",
  ],
  state: [
    "GET /api/state",
    "GET /api/currency",
    "PUT /api/state",
    "POST /api/query/panel",
    "GET|POST /api/data-sources",
    "PATCH|DELETE /api/data-sources/:id",
    "GET|POST /api/metrics",
    "PATCH|DELETE /api/metrics/:id",
    "GET|POST /api/dashboards",
    "PATCH|DELETE /api/dashboards/:id",
    "POST /api/dashboards/:dashboardId/panels",
    "PATCH|DELETE /api/dashboards/:dashboardId/panels/:panelId",
    "GET|POST /api/alerts",
    "PATCH|DELETE /api/alerts/:id",
    "GET|POST /api/templates",
    "PATCH|DELETE /api/templates/:id",
  ],
  connectors: [
    "GET /api/connectors/zhupay/status",
    "POST /api/connectors/zhupay/sync",
    "GET /api/connectors/zhupay/scheduler",
    "GET /api/connectors/zhupay/summary",
    "GET /api/connectors/zhupay/orders",
    "GET /api/connectors/zhupay/notify",
    "GET /api/connectors/creem/status",
    "POST /api/connectors/creem/sync",
    "GET /api/connectors/creem/scheduler",
    "GET /api/connectors/creem/summary",
    "GET /api/connectors/creem/transactions",
    "POST /api/connectors/creem/webhook",
    "GET /api/connectors/manual-revenue/status",
    "GET|POST /api/connectors/manual-revenue/entries",
    "PATCH|DELETE /api/connectors/manual-revenue/entries/:id",
    "GET /api/connectors/sub2api/status",
    "POST /api/connectors/sub2api/sync",
  ],
  admin: ["GET /api/admin/users", "DELETE /api/admin/users/:userId", "GET /api/admin/audit-logs"],
};

function asyncRoute(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function readBearerToken(req) {
  const header = req.get("authorization") ?? "";
  const match = header.match(/^bearer\s+(.+)$/i);
  return match?.[1]?.trim();
}

function readAuthSecret(req) {
  return req.get("x-api-key")?.trim() || readBearerToken(req);
}

function requireAuth(req, res, next) {
  const secret = readAuthSecret(req);
  if (!secret) {
    res.status(401).json({ error: { message: "Authentication required" } });
    return;
  }

  findAuthBySecret(secret)
    .then((auth) => {
      if (!auth) {
        res.status(401).json({ error: { message: "Invalid or expired credentials" } });
        return;
      }

      req.auth = auth;
      req.authSecret = secret;
      next();
    })
    .catch(next);
}

function requireAdmin(req, res, next) {
  if (req.auth?.user?.role !== "admin" || req.auth?.apiKeyScope === "user") {
    res.status(403).json({ error: { message: "Admin permission required" } });
    return;
  }
  next();
}

function assertObject(value, message = "Request body must be a JSON object") {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    const error = new Error(message);
    error.status = 400;
    throw error;
  }
}

function validateCredentials({ email, password }) {
  if (!email || !String(email).includes("@")) {
    const error = new Error("Valid email is required");
    error.status = 400;
    throw error;
  }
  if (!password || String(password).length < 8) {
    const error = new Error("Password must be at least 8 characters");
    error.status = 400;
    throw error;
  }
}

app.get("/api/health", asyncRoute(async (_req, res) => {
  await pool.query("select 1");
  res.json({ ok: true, service: "dataocean", database: "postgres" });
}));

app.get("/api/schema", (_req, res) => {
  res.json(apiSpec);
});

app.post("/api/auth/register", asyncRoute(async (req, res) => {
  assertObject(req.body);
  validateCredentials(req.body);

  const { user, apiKey } = await createUser(req.body);
  const session = await createSession(user.id);
  res.status(201).json({ user, apiKey, ...session });
}));

app.post("/api/auth/login", asyncRoute(async (req, res) => {
  assertObject(req.body);
  validateCredentials(req.body);

  const result = await loginUser(req.body);
  res.json(result);
}));

app.post("/api/auth/logout", requireAuth, asyncRoute(async (req, res) => {
  if (req.auth?.type === "session") {
    await logoutSession(req.authSecret);
  }
  res.status(204).end();
}));

app.get("/api/auth/me", requireAuth, (req, res) => {
  res.json({ user: req.auth.user, authType: req.auth.type });
});

app.post("/api/auth/api-key/rotate", requireAuth, asyncRoute(async (req, res) => {
  const result = await rotateApiKey(req.auth.user.id);
  res.json(result);
}));

app.get("/api/admin/users", requireAuth, requireAdmin, asyncRoute(async (_req, res) => {
  res.json({ users: await listUsers() });
}));

app.delete("/api/admin/users/:userId", requireAuth, requireAdmin, asyncRoute(async (req, res) => {
  res.json({ user: await deleteUser(req.params.userId, req.auth.user.id) });
}));

app.get("/api/admin/audit-logs", requireAuth, requireAdmin, asyncRoute(async (req, res) => {
  res.json({ auditLogs: await listAuditLogs({ limit: req.query.limit }) });
}));

app.get("/api/state", requireAuth, asyncRoute(async (_req, res) => {
  res.json(await getAppState());
}));

app.get("/api/currency", requireAuth, (_req, res) => {
  res.json(getCurrencyDisplayConfig());
});

app.put("/api/state", requireAuth, requireAdmin, asyncRoute(async (req, res) => {
  assertObject(req.body);
  res.json(await replaceAppState(req.body, req.auth.user.id));
}));

app.post("/api/query/panel", requireAuth, asyncRoute(async (req, res) => {
  assertObject(req.body);
  const panel = req.body;
  const state = await getAppState();
  const dataSource = state.dataSources.find((item) => item.id === panel.query?.dataSourceId);
  const metric = state.metrics.find((item) => item.key === panel.query?.metric || item.id === panel.query?.metric);

  if (!dataSource || !metric) {
    const error = new Error("Panel query references an unknown data source or metric");
    error.status = 404;
    throw error;
  }

  if (dataSource.kind === "zhupay") {
    res.json(await queryZhupayMetric({ dataSource, metric, query: panel.query }));
    return;
  }

  if (dataSource.kind === "creem") {
    res.json(await queryCreemMetric({ dataSource, metric, query: panel.query }));
    return;
  }

  if (dataSource.kind === "aggregate") {
    res.json(await queryRevenueMetric({ dataSource, metric, query: panel.query }));
    return;
  }

  if (dataSource.kind === "manual") {
    res.json(await queryManualRevenueMetric({ dataSource, metric, query: panel.query }));
    return;
  }

  if (dataSource.kind === "sub2api") {
    res.json(await querySub2ApiMetric({ dataSource, metric, query: panel.query }));
    return;
  }

  {
    const error = new Error(`Server-side connector is not implemented for ${dataSource.kind}`);
    error.status = 501;
    throw error;
  }
}));

app.get("/api/connectors/zhupay/status", requireAuth, asyncRoute(async (_req, res) => {
  res.json(await getZhupayStatus());
}));

app.get("/api/connectors/zhupay/scheduler", requireAuth, asyncRoute(async (_req, res) => {
  const status = await getZhupayStatus();
  res.json(status.scheduler);
}));

app.get("/api/connectors/zhupay/summary", requireAuth, asyncRoute(async (_req, res) => {
  res.json(await getZhupaySummary());
}));

app.get("/api/connectors/zhupay/orders", requireAuth, asyncRoute(async (req, res) => {
  res.json({ orders: await listZhupayOrders({ limit: req.query.limit }) });
}));

app.post("/api/connectors/zhupay/sync", requireAuth, requireAdmin, asyncRoute(async (req, res) => {
  res.json(await syncZhupay({
    maxPages: req.body?.maxPages,
    limit: req.body?.limit,
  }));
}));

app.get("/api/connectors/zhupay/notify", asyncRoute(async (req, res) => {
  await handleZhupayNotify(req.query);
  res.type("text/plain").send("success");
}));

app.get("/api/connectors/creem/status", requireAuth, asyncRoute(async (_req, res) => {
  res.json(await getCreemStatus());
}));

app.get("/api/connectors/creem/scheduler", requireAuth, asyncRoute(async (_req, res) => {
  const status = await getCreemStatus();
  res.json(status.scheduler);
}));

app.get("/api/connectors/creem/summary", requireAuth, asyncRoute(async (_req, res) => {
  res.json(await getCreemSummary());
}));

app.get("/api/connectors/creem/transactions", requireAuth, asyncRoute(async (req, res) => {
  res.json({ transactions: await listCreemTransactions({ limit: req.query.limit }) });
}));

app.post("/api/connectors/creem/sync", requireAuth, requireAdmin, asyncRoute(async (req, res) => {
  res.json(await syncCreem({
    maxPages: req.body?.maxPages,
    pageSize: req.body?.pageSize,
  }));
}));

app.post("/api/connectors/creem/webhook", asyncRoute(async (req, res) => {
  const result = await handleCreemWebhook({
    rawBody: req.rawBody,
    signature: req.get("creem-signature"),
    body: req.body,
  });
  res.json(result);
}));

app.get("/api/connectors/manual-revenue/status", requireAuth, asyncRoute(async (_req, res) => {
  res.json(await getManualRevenueStatus());
}));

app.get("/api/connectors/manual-revenue/entries", requireAuth, asyncRoute(async (req, res) => {
  res.json({ entries: await listManualRevenueEntries({ limit: req.query.limit }) });
}));

app.post("/api/connectors/manual-revenue/entries", requireAuth, asyncRoute(async (req, res) => {
  assertObject(req.body);
  res.status(201).json({ entry: await createManualRevenueEntry(req.body, req.auth.user) });
}));

app.patch("/api/connectors/manual-revenue/entries/:id", requireAuth, asyncRoute(async (req, res) => {
  assertObject(req.body);
  res.json({ entry: await updateManualRevenueEntry(req.params.id, req.body, req.auth.user) });
}));

app.delete("/api/connectors/manual-revenue/entries/:id", requireAuth, asyncRoute(async (req, res) => {
  res.json({ entry: await deleteManualRevenueEntry(req.params.id, req.auth.user) });
}));

app.get("/api/connectors/sub2api/status", requireAuth, asyncRoute(async (_req, res) => {
  res.json(await getSub2ApiStatus());
}));

app.post("/api/connectors/sub2api/sync", requireAuth, requireAdmin, asyncRoute(async (_req, res) => {
  res.json(await syncSub2Api());
}));

for (const slug of ["data-sources", "metrics", "dashboards", "alerts", "templates"]) {
  app.get(`/api/${slug}`, requireAuth, asyncRoute(async (_req, res) => {
    res.json({ items: await listCollection(slug) });
  }));

  app.post(`/api/${slug}`, requireAuth, requireAdmin, asyncRoute(async (req, res) => {
    assertObject(req.body);
    res.status(201).json(await createCollectionItem(slug, req.body, req.auth.user.id));
  }));

  app.patch(`/api/${slug}/:id`, requireAuth, requireAdmin, asyncRoute(async (req, res) => {
    assertObject(req.body);
    res.json(await updateCollectionItem(slug, req.params.id, req.body, req.auth.user.id));
  }));

  app.delete(`/api/${slug}/:id`, requireAuth, requireAdmin, asyncRoute(async (req, res) => {
    res.json(await deleteCollectionItem(slug, req.params.id, req.auth.user.id));
  }));
}

app.post("/api/dashboards/:dashboardId/panels", requireAuth, requireAdmin, asyncRoute(async (req, res) => {
  assertObject(req.body);
  res.status(201).json(await createDashboardPanel(req.params.dashboardId, req.body, req.auth.user.id));
}));

app.patch("/api/dashboards/:dashboardId/panels/:panelId", requireAuth, requireAdmin, asyncRoute(async (req, res) => {
  assertObject(req.body);
  res.json(await updateDashboardPanel(req.params.dashboardId, req.params.panelId, req.body, req.auth.user.id));
}));

app.delete("/api/dashboards/:dashboardId/panels/:panelId", requireAuth, requireAdmin, asyncRoute(async (req, res) => {
  res.json(await deleteDashboardPanel(req.params.dashboardId, req.params.panelId, req.auth.user.id));
}));

app.use(express.static(distDir, { index: false }));
app.use((req, res, next) => {
  if (req.path.startsWith("/api/")) {
    next();
    return;
  }
  res.sendFile(path.join(distDir, "index.html"));
});

app.use((req, res) => {
  res.status(404).json({ error: { message: "Not found" } });
});

app.use((error, _req, res, _next) => {
  const status = Number(error.status ?? 500);
  if (status >= 500) {
    console.error(error);
  }
  res.status(status).json({
    error: {
      message: error.message ?? "Internal server error",
    },
  });
});

await waitForDatabase();
await migrateDatabase();

app.listen(port, "0.0.0.0", () => {
  console.log(`DataOcean API listening on ${port}`);
  startZhupayScheduler();
  startCreemScheduler();
});
