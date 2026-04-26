export function SettingsPage() {
  return (
    <section className="mt-grid">
      <article className="mt-card mt-span-6">
        <div className="mt-card-header">
          <div>
            <h2 className="mt-card-title">Team</h2>
            <p className="mt-card-subtitle">Access control and workspace defaults.</p>
          </div>
        </div>
        <div className="mt-card-body do-settings-stack">
          <label className="mt-field">
            <span className="mt-label">Workspace name</span>
            <input className="mt-input" defaultValue="DataOcean Core" />
          </label>
          <label className="mt-field">
            <span className="mt-label">Default time range</span>
            <input className="mt-input" defaultValue="1D" />
          </label>
          <label className="mt-field">
            <span className="mt-label">Default refresh</span>
            <input className="mt-input" defaultValue="10 seconds" />
          </label>
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
