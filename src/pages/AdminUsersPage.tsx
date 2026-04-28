import { useEffect, useMemo, useState } from "react";
import { apiClient } from "../api/client";
import type { AuthUser } from "../domain/types";
import { formatDateTime } from "../lib/format";
import { useI18n } from "../lib/i18n";

type AdminUsersPageProps = {
  currentUser: AuthUser;
};

export function AdminUsersPage({ currentUser }: AdminUsersPageProps) {
  const { intlLocale, t, te } = useI18n();
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const stats = useMemo(
    () => ({
      total: users.length,
      admins: users.filter((user) => user.role === "admin").length,
      members: users.filter((user) => user.role === "member").length,
    }),
    [users],
  );

  useEffect(() => {
    let cancelled = false;

    async function loadUsers() {
      setLoading(true);
      setError("");

      try {
        const result = await apiClient.listAdminUsers();
        if (!cancelled) {
          setUsers(result.users);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : t("admin.users.loadError"));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadUsers();

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleDeleteUser(user: AuthUser) {
    if (user.id === currentUser.id) {
      setError(t("admin.users.selfDeleteError"));
      return;
    }

    const confirmed = window.confirm(t("admin.users.confirmDelete", { email: user.email }));
    if (!confirmed) {
      return;
    }

    setDeletingUserId(user.id);
    setError("");
    setMessage("");

    try {
      await apiClient.deleteAdminUser(user.id);
      setUsers((items) => items.filter((item) => item.id !== user.id));
      setMessage(t("admin.users.deleted", { email: user.email }));
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : t("admin.users.deleteError"));
    } finally {
      setDeletingUserId(null);
    }
  }

  return (
    <section className="mt-grid">
      <article className="mt-card mt-span-12">
        <div className="mt-card-header">
          <div>
            <h2 className="mt-card-title">{t("admin.users.title")}</h2>
            <p className="mt-card-subtitle">{t("admin.users.subtitle")}</p>
          </div>
          <span className="mt-badge" data-intent="positive">
            {te("role", "admin")}
          </span>
        </div>

        <div className="do-admin-stats">
          <div>
            <span>{t("admin.users.total")}</span>
            <strong>{stats.total}</strong>
          </div>
          <div>
            <span>{t("admin.users.admins")}</span>
            <strong>{stats.admins}</strong>
          </div>
          <div>
            <span>{t("admin.users.members")}</span>
            <strong>{stats.members}</strong>
          </div>
        </div>

        {error ? <div className="do-auth-error do-admin-message">{error}</div> : null}
        {message ? <div className="do-admin-success do-admin-message">{message}</div> : null}

        {loading ? (
          <div className="do-empty-state do-table-empty">
            <h2>{t("admin.users.loadingTitle")}</h2>
            <p>{t("admin.users.loadingText")}</p>
          </div>
        ) : users.length === 0 ? (
          <div className="do-empty-state do-table-empty">
            <h2>{t("admin.users.emptyTitle")}</h2>
            <p>{t("admin.users.emptyText")}</p>
          </div>
        ) : (
          <div className="do-table-scroll">
            <table className="mt-table">
              <thead>
                <tr>
                  <th>{t("admin.users.user")}</th>
                  <th>{t("settings.role")}</th>
                  <th>{t("admin.users.apiScope")}</th>
                  <th>{t("admin.users.apiKey")}</th>
                  <th>{t("admin.users.created")}</th>
                  <th>{t("admin.users.updated")}</th>
                  <th>{t("common.action")}</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => {
                  const isCurrentUser = user.id === currentUser.id;

                  return (
                    <tr key={user.id}>
                      <td>
                        <strong>{user.name}</strong>
                        <div className="do-table-subtext">{user.email}</div>
                      </td>
                      <td>
                        <span className="mt-badge" data-intent={user.role === "admin" ? "positive" : undefined}>
                          {te("role", user.role)}
                        </span>
                      </td>
                      <td>{te("scope", user.apiKeyScope)}</td>
                      <td>{user.apiKeyPrefix}...</td>
                      <td>{formatDateTime(user.createdAt, intlLocale)}</td>
                      <td>{formatDateTime(user.updatedAt, intlLocale)}</td>
                      <td>
                        <button
                          className="mt-button"
                          data-variant="danger"
                          disabled={isCurrentUser || deletingUserId === user.id}
                          onClick={() => void handleDeleteUser(user)}
                          type="button"
                        >
                          {isCurrentUser ? t("admin.users.currentUser") : deletingUserId === user.id ? t("common.deleting") : t("common.delete")}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </article>
    </section>
  );
}
