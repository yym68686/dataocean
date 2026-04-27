import type { AuthUser } from "../domain/types";

type SettingsPageProps = {
  user: AuthUser;
  issuedApiKey?: string;
  onLogout: () => void;
  onRotateApiKey: () => void;
};

export function SettingsPage({ user, issuedApiKey, onLogout, onRotateApiKey }: SettingsPageProps) {
  return (
    <section className="mt-grid">
      <article className="mt-card mt-span-6">
        <div className="mt-card-header">
          <div>
            <h2 className="mt-card-title">Account</h2>
            <p className="mt-card-subtitle">Session, role, and API access.</p>
          </div>
          <button className="mt-button" onClick={onLogout} type="button">
            Sign out
          </button>
        </div>
        <div className="mt-card-body do-settings-stack">
          <label className="mt-field">
            <span className="mt-label">Email</span>
            <input className="mt-input" readOnly value={user.email} />
          </label>
          <label className="mt-field">
            <span className="mt-label">Role</span>
            <input className="mt-input" readOnly value={`${user.role} / ${user.apiKeyScope} api key`} />
          </label>
          <label className="mt-field">
            <span className="mt-label">API key prefix</span>
            <input className="mt-input" readOnly value={`${user.apiKeyPrefix}...`} />
          </label>
          {issuedApiKey ? (
            <label className="mt-field">
              <span className="mt-label">New API key</span>
              <input className="mt-input" readOnly value={issuedApiKey} />
            </label>
          ) : null}
          <button className="mt-button" onClick={onRotateApiKey} type="button">
            Rotate API key
          </button>
        </div>
      </article>

      <article className="mt-card mt-span-6">
        <div className="mt-card-header">
          <div>
            <h2 className="mt-card-title">Platform Roadmap</h2>
            <p className="mt-card-subtitle">Next implementation layers.</p>
          </div>
        </div>
        <div className="mt-card-body">
          <ul className="do-roadmap">
            <li>Persist dashboards and ChartSpec JSON in PostgreSQL.</li>
            <li>Add real REST API connector execution with credential vaulting.</li>
            <li>Add SQL and PromQL query builders.</li>
            <li>Add webhook ingestion and live event streaming.</li>
            <li>Add AI-assisted metric and dashboard generation.</li>
          </ul>
        </div>
      </article>
    </section>
  );
}
