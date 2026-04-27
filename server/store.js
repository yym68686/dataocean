import { randomUUID } from "node:crypto";
import { pool } from "./database.js";
import {
  generateApiKey,
  generateId,
  generateSessionToken,
  getSecretPrefix,
  hashPassword,
  hashSecret,
  normalizeEmail,
  verifyPassword,
} from "./security.js";
import { defaultAppState } from "./defaultState.js";

const SESSION_TTL_DAYS = Number(process.env.SESSION_TTL_DAYS ?? 14);

const collectionConfig = {
  "data-sources": { key: "dataSources", prefix: "source", resourceType: "data_source" },
  metrics: { key: "metrics", prefix: "metric", resourceType: "metric" },
  dashboards: { key: "dashboards", prefix: "dashboard", resourceType: "dashboard" },
  alerts: { key: "alerts", prefix: "alert", resourceType: "alert" },
  templates: { key: "templates", prefix: "template", resourceType: "template" },
};

function toPublicUser(row) {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    apiKeyPrefix: row.api_key_prefix,
    apiKeyScope: row.api_key_scope,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeState(input = {}) {
  const dashboards = Array.isArray(input.dashboards)
    ? input.dashboards
    : input.dashboard
      ? [input.dashboard]
      : defaultAppState.dashboards;
  const activeDashboardId = input.activeDashboardId ?? input.dashboard?.id ?? dashboards[0]?.id;

  return {
    dataSources: Array.isArray(input.dataSources) ? input.dataSources : defaultAppState.dataSources,
    metrics: Array.isArray(input.metrics) ? input.metrics : defaultAppState.metrics,
    activeDashboardId,
    dashboards,
    alerts: Array.isArray(input.alerts) ? input.alerts : defaultAppState.alerts,
    templates: Array.isArray(input.templates) ? input.templates : defaultAppState.templates,
  };
}

function toClientState(state) {
  const normalized = normalizeState(state);
  const dashboard =
    normalized.dashboards.find((item) => item.id === normalized.activeDashboardId) ??
    normalized.dashboards[0] ??
    defaultAppState.dashboards[0];

  return {
    ...normalized,
    dashboard,
  };
}

async function readState(client = pool, { lock = false } = {}) {
  const result = await client.query(
    `select value from app_state where key = 'main'${lock ? " for update" : ""}`,
  );
  return normalizeState(result.rows[0]?.value ?? defaultAppState);
}

async function writeState(client, state, userId) {
  await client.query(
    `
      insert into app_state (key, value, updated_at, updated_by)
      values ('main', $1::jsonb, now(), $2)
      on conflict (key) do update
        set value = excluded.value,
            updated_at = now(),
            updated_by = excluded.updated_by
    `,
    [JSON.stringify(normalizeState(state)), userId ?? null],
  );
}

async function writeAudit(client, userId, action, resourceType, resourceId, payload) {
  await client.query(
    `
      insert into audit_logs (user_id, action, resource_type, resource_id, payload)
      values ($1, $2, $3, $4, $5::jsonb)
    `,
    [userId ?? null, action, resourceType, resourceId ?? null, JSON.stringify(payload ?? null)],
  );
}

export async function createUser({ email, password, name }) {
  const normalizedEmail = normalizeEmail(email);
  const displayName = String(name ?? normalizedEmail.split("@")[0] ?? "DataOcean User").trim();
  const passwordHash = await hashPassword(password);
  const client = await pool.connect();

  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(68686001)");

    const existing = await client.query("select id from users where email = $1", [normalizedEmail]);
    if (existing.rowCount > 0) {
      const error = new Error("Email is already registered");
      error.status = 409;
      throw error;
    }

    const countResult = await client.query("select count(*)::int as count from users");
    const isFirstUser = Number(countResult.rows[0]?.count ?? 0) === 0;
    const role = isFirstUser ? "admin" : "member";
    const apiKeyScope = isFirstUser ? "admin" : "user";
    const apiKey = generateApiKey(apiKeyScope);
    const userResult = await client.query(
      `
        insert into users (
          id, email, name, password_hash, role, api_key_hash, api_key_prefix, api_key_scope
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8)
        returning id, email, name, role, api_key_prefix, api_key_scope, created_at, updated_at
      `,
      [
        randomUUID(),
        normalizedEmail,
        displayName || normalizedEmail,
        passwordHash,
        role,
        hashSecret(apiKey),
        getSecretPrefix(apiKey),
        apiKeyScope,
      ],
    );

    await writeAudit(client, userResult.rows[0].id, "create", "user", userResult.rows[0].id, {
      email: normalizedEmail,
      role,
    });
    await client.query("commit");

    return { user: toPublicUser(userResult.rows[0]), apiKey };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function createSession(userId) {
  const token = generateSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);

  await pool.query(
    `
      insert into sessions (token_hash, user_id, expires_at)
      values ($1, $2, $3)
    `,
    [hashSecret(token), userId, expiresAt.toISOString()],
  );

  return { token, expiresAt: expiresAt.toISOString() };
}

export async function loginUser({ email, password }) {
  const normalizedEmail = normalizeEmail(email);
  const result = await pool.query(
    `
      select id, email, name, password_hash, role, api_key_prefix, api_key_scope, created_at, updated_at
      from users
      where email = $1
    `,
    [normalizedEmail],
  );

  const row = result.rows[0];
  if (!row || !(await verifyPassword(password, row.password_hash))) {
    const error = new Error("Invalid email or password");
    error.status = 401;
    throw error;
  }

  const session = await createSession(row.id);
  return { user: toPublicUser(row), ...session };
}

export async function logoutSession(token) {
  await pool.query("delete from sessions where token_hash = $1", [hashSecret(token)]);
}

export async function findAuthBySecret(secret) {
  const hashedSecret = hashSecret(secret);

  const sessionResult = await pool.query(
    `
      select
        u.id, u.email, u.name, u.role, u.api_key_prefix, u.api_key_scope, u.created_at, u.updated_at,
        s.expires_at
      from sessions s
      join users u on u.id = s.user_id
      where s.token_hash = $1 and s.expires_at > now()
    `,
    [hashedSecret],
  );

  if (sessionResult.rows[0]) {
    return {
      type: "session",
      user: toPublicUser(sessionResult.rows[0]),
      expiresAt: sessionResult.rows[0].expires_at,
    };
  }

  const apiKeyResult = await pool.query(
    `
      select id, email, name, role, api_key_prefix, api_key_scope, created_at, updated_at
      from users
      where api_key_hash = $1
    `,
    [hashedSecret],
  );

  if (apiKeyResult.rows[0]) {
    return {
      type: "api_key",
      user: toPublicUser(apiKeyResult.rows[0]),
      apiKeyScope: apiKeyResult.rows[0].api_key_scope,
    };
  }

  return null;
}

export async function rotateApiKey(userId) {
  const result = await pool.query(
    "select id, role from users where id = $1",
    [userId],
  );
  const row = result.rows[0];
  if (!row) {
    const error = new Error("User not found");
    error.status = 404;
    throw error;
  }

  const apiKeyScope = row.role === "admin" ? "admin" : "user";
  const apiKey = generateApiKey(apiKeyScope);
  const updateResult = await pool.query(
    `
      update users
      set api_key_hash = $1,
          api_key_prefix = $2,
          api_key_scope = $3,
          updated_at = now()
      where id = $4
      returning id, email, name, role, api_key_prefix, api_key_scope, created_at, updated_at
    `,
    [hashSecret(apiKey), getSecretPrefix(apiKey), apiKeyScope, userId],
  );

  return { user: toPublicUser(updateResult.rows[0]), apiKey };
}

export async function listUsers() {
  const result = await pool.query(
    `
      select id, email, name, role, api_key_prefix, api_key_scope, created_at, updated_at
      from users
      order by created_at asc
    `,
  );
  return result.rows.map(toPublicUser);
}

export async function deleteUser(targetUserId, actorUserId) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(targetUserId))) {
    const error = new Error("Invalid user id");
    error.status = 400;
    throw error;
  }

  if (targetUserId === actorUserId) {
    const error = new Error("Administrators cannot delete their own account");
    error.status = 400;
    throw error;
  }

  const client = await pool.connect();

  try {
    await client.query("begin");

    const targetResult = await client.query(
      `
        select id, email, name, role, api_key_prefix, api_key_scope, created_at, updated_at
        from users
        where id = $1
        for update
      `,
      [targetUserId],
    );
    const target = targetResult.rows[0];

    if (!target) {
      const error = new Error("User not found");
      error.status = 404;
      throw error;
    }

    if (target.role === "admin") {
      const adminCountResult = await client.query("select count(*)::int as count from users where role = 'admin'");
      if (Number(adminCountResult.rows[0]?.count ?? 0) <= 1) {
        const error = new Error("Cannot delete the last administrator");
        error.status = 409;
        throw error;
      }
    }

    await client.query("delete from users where id = $1", [targetUserId]);
    await writeAudit(client, actorUserId, "delete", "user", targetUserId, {
      email: target.email,
      role: target.role,
    });
    await client.query("commit");

    return toPublicUser(target);
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function listAuditLogs({ limit = 100 } = {}) {
  const result = await pool.query(
    `
      select
        a.id, a.action, a.resource_type, a.resource_id, a.payload, a.created_at,
        u.email as user_email
      from audit_logs a
      left join users u on u.id = a.user_id
      order by a.created_at desc
      limit $1
    `,
    [Math.min(Math.max(Number(limit) || 100, 1), 500)],
  );

  return result.rows.map((row) => ({
    id: row.id,
    action: row.action,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    payload: row.payload,
    createdAt: row.created_at,
    userEmail: row.user_email,
  }));
}

export async function getAppState() {
  return toClientState(await readState());
}

export async function replaceAppState(nextState, userId) {
  const client = await pool.connect();

  try {
    await client.query("begin");
    const state = normalizeState(nextState);
    await writeState(client, state, userId);
    await writeAudit(client, userId, "replace", "app_state", "main", state);
    await client.query("commit");
    return toClientState(state);
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export function getCollectionConfig(slug) {
  const config = collectionConfig[slug];
  if (!config) {
    const error = new Error("Unknown collection");
    error.status = 404;
    throw error;
  }
  return config;
}

export async function listCollection(slug) {
  const config = getCollectionConfig(slug);
  const state = await readState();
  return state[config.key] ?? [];
}

export async function createCollectionItem(slug, item, userId) {
  const config = getCollectionConfig(slug);
  const client = await pool.connect();

  try {
    await client.query("begin");
    const state = await readState(client, { lock: true });
    const collection = [...(state[config.key] ?? [])];
    const nextItem = {
      id: item.id ?? generateId(config.prefix),
      ...item,
    };

    collection.push(nextItem);
    state[config.key] = collection;
    if (config.key === "dashboards" && !state.activeDashboardId) {
      state.activeDashboardId = nextItem.id;
    }

    await writeState(client, state, userId);
    await writeAudit(client, userId, "create", config.resourceType, nextItem.id, nextItem);
    await client.query("commit");

    return nextItem;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function updateCollectionItem(slug, id, patch, userId) {
  const config = getCollectionConfig(slug);
  const client = await pool.connect();

  try {
    await client.query("begin");
    const state = await readState(client, { lock: true });
    const collection = [...(state[config.key] ?? [])];
    const index = collection.findIndex((item) => item.id === id);

    if (index < 0) {
      const error = new Error("Item not found");
      error.status = 404;
      throw error;
    }

    const nextItem = { ...collection[index], ...patch, id };
    collection[index] = nextItem;
    state[config.key] = collection;

    await writeState(client, state, userId);
    await writeAudit(client, userId, "update", config.resourceType, id, patch);
    await client.query("commit");

    return nextItem;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function deleteCollectionItem(slug, id, userId) {
  const config = getCollectionConfig(slug);
  const client = await pool.connect();

  try {
    await client.query("begin");
    const state = await readState(client, { lock: true });
    const collection = [...(state[config.key] ?? [])];
    const nextCollection = collection.filter((item) => item.id !== id);

    if (collection.length === nextCollection.length) {
      const error = new Error("Item not found");
      error.status = 404;
      throw error;
    }

    state[config.key] = nextCollection;
    if (config.key === "dashboards" && state.activeDashboardId === id) {
      state.activeDashboardId = nextCollection[0]?.id ?? null;
    }

    await writeState(client, state, userId);
    await writeAudit(client, userId, "delete", config.resourceType, id, null);
    await client.query("commit");

    return { id };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function createDashboardPanel(dashboardId, panel, userId) {
  const client = await pool.connect();

  try {
    await client.query("begin");
    const state = await readState(client, { lock: true });
    const dashboard = state.dashboards.find((item) => item.id === dashboardId);

    if (!dashboard) {
      const error = new Error("Dashboard not found");
      error.status = 404;
      throw error;
    }

    const nextPanel = { id: panel.id ?? generateId("panel"), ...panel };
    dashboard.panels = [...(dashboard.panels ?? []), nextPanel];

    await writeState(client, state, userId);
    await writeAudit(client, userId, "create", "panel", nextPanel.id, { dashboardId, panel: nextPanel });
    await client.query("commit");

    return nextPanel;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function updateDashboardPanel(dashboardId, panelId, patch, userId) {
  const client = await pool.connect();

  try {
    await client.query("begin");
    const state = await readState(client, { lock: true });
    const dashboard = state.dashboards.find((item) => item.id === dashboardId);

    if (!dashboard) {
      const error = new Error("Dashboard not found");
      error.status = 404;
      throw error;
    }

    const panels = [...(dashboard.panels ?? [])];
    const index = panels.findIndex((item) => item.id === panelId);

    if (index < 0) {
      const error = new Error("Panel not found");
      error.status = 404;
      throw error;
    }

    const nextPanel = { ...panels[index], ...patch, id: panelId };
    panels[index] = nextPanel;
    dashboard.panels = panels;

    await writeState(client, state, userId);
    await writeAudit(client, userId, "update", "panel", panelId, { dashboardId, patch });
    await client.query("commit");

    return nextPanel;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function deleteDashboardPanel(dashboardId, panelId, userId) {
  const client = await pool.connect();

  try {
    await client.query("begin");
    const state = await readState(client, { lock: true });
    const dashboard = state.dashboards.find((item) => item.id === dashboardId);

    if (!dashboard) {
      const error = new Error("Dashboard not found");
      error.status = 404;
      throw error;
    }

    const panels = [...(dashboard.panels ?? [])];
    const nextPanels = panels.filter((item) => item.id !== panelId);

    if (panels.length === nextPanels.length) {
      const error = new Error("Panel not found");
      error.status = 404;
      throw error;
    }

    dashboard.panels = nextPanels;
    await writeState(client, state, userId);
    await writeAudit(client, userId, "delete", "panel", panelId, { dashboardId });
    await client.query("commit");

    return { id: panelId };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
