import { useEffect, useMemo, useState } from "react";
import { apiClient } from "../api/client";
import type { AuthUser } from "../domain/types";

type AdminUsersPageProps = {
  currentUser: AuthUser;
};

export function AdminUsersPage({ currentUser }: AdminUsersPageProps) {
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
          setError(loadError instanceof Error ? loadError.message : "Could not load users");
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
      setError("Administrators cannot delete their own account.");
      return;
    }

    const confirmed = window.confirm(`Delete ${user.email}? This will revoke their sessions and API key.`);
    if (!confirmed) {
      return;
    }

    setDeletingUserId(user.id);
    setError("");
    setMessage("");

    try {
      await apiClient.deleteAdminUser(user.id);
      setUsers((items) => items.filter((item) => item.id !== user.id));
      setMessage(`${user.email} was deleted.`);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Could not delete user");
    } finally {
      setDeletingUserId(null);
    }
  }

  return (
    <section className="mt-grid">
      <article className="mt-card mt-span-12">
        <div className="mt-card-header">
          <div>
            <h2 className="mt-card-title">User Management</h2>
            <p className="mt-card-subtitle">Admin-only access control, API key scope, and account removal.</p>
          </div>
          <span className="mt-badge" data-intent="positive">
            admin
          </span>
        </div>

        <div className="do-admin-stats">
          <div>
            <span>Total</span>
            <strong>{stats.total}</strong>
          </div>
          <div>
            <span>Admins</span>
            <strong>{stats.admins}</strong>
          </div>
          <div>
            <span>Members</span>
            <strong>{stats.members}</strong>
          </div>
        </div>

        {error ? <div className="do-auth-error do-admin-message">{error}</div> : null}
        {message ? <div className="do-admin-success do-admin-message">{message}</div> : null}

        {loading ? (
          <div className="do-empty-state do-table-empty">
            <h2>Loading users</h2>
            <p>Fetching the current workspace accounts.</p>
          </div>
        ) : users.length === 0 ? (
          <div className="do-empty-state do-table-empty">
            <h2>No users</h2>
            <p>Accounts will appear after registration.</p>
          </div>
        ) : (
          <div className="do-table-scroll">
            <table className="mt-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Role</th>
                  <th>API Scope</th>
                  <th>API Key</th>
                  <th>Created</th>
                  <th>Updated</th>
                  <th>Action</th>
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
                          {user.role}
                        </span>
                      </td>
                      <td>{user.apiKeyScope}</td>
                      <td>{user.apiKeyPrefix}...</td>
                      <td>{formatUserDate(user.createdAt)}</td>
                      <td>{formatUserDate(user.updatedAt)}</td>
                      <td>
                        <button
                          className="mt-button"
                          data-variant="danger"
                          disabled={isCurrentUser || deletingUserId === user.id}
                          onClick={() => void handleDeleteUser(user)}
                          type="button"
                        >
                          {isCurrentUser ? "Current user" : deletingUserId === user.id ? "Deleting" : "Delete"}
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

function formatUserDate(value: string) {
  return new Date(value).toLocaleString();
}
