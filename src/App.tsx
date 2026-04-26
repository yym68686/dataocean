import { useEffect, useMemo, useState } from "react";
import { alerts, dashboard, dataSources, metrics, templates } from "./data/seed";
import { sectionLabels, timeRanges } from "./domain/constants";
import type { AppSection, ChartSpec, ThemeMode, TimeRange } from "./domain/types";
import { AlertsPage } from "./pages/AlertsPage";
import { DashboardPage } from "./pages/DashboardPage";
import { DataSourcesPage } from "./pages/DataSourcesPage";
import { MetricsPage } from "./pages/MetricsPage";
import { TemplatesPage } from "./pages/TemplatesPage";
import { SettingsPage } from "./pages/SettingsPage";
import { Inspector } from "./components/Inspector";

const sections: AppSection[] = [
  "command",
  "dashboards",
  "datasources",
  "metrics",
  "alerts",
  "templates",
  "settings",
];

export default function App() {
  const [activeSection, setActiveSection] = useState<AppSection>("command");
  const [theme, setTheme] = useState<ThemeMode>("light");
  const [activeRange, setActiveRange] = useState<TimeRange>(dashboard.defaultTimeRange);
  const [selectedPanelId, setSelectedPanelId] = useState(dashboard.panels[4]?.id ?? dashboard.panels[0]?.id);

  const selectedPanel = useMemo(
    () => dashboard.panels.find((panel) => panel.id === selectedPanelId) ?? dashboard.panels[0],
    [selectedPanelId],
  );

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const currentTitle = activeSection === "command" ? dashboard.name : sectionLabels[activeSection];

  return (
    <div className="mt-app do-app">
      <aside className="mt-sidebar do-sidebar">
        <button className="do-brand-button" onClick={() => setActiveSection("command")} type="button">
          <span className="mt-brand-mark" aria-hidden="true" />
          <span>DataOcean</span>
        </button>

        <nav className="mt-nav" aria-label="Primary">
          {sections.map((section) => (
            <button
              className="mt-nav-item do-nav-button"
              data-active={activeSection === section}
              key={section}
              onClick={() => setActiveSection(section)}
              type="button"
            >
              <span className="mt-dot" />
              <span>{sectionLabels[section]}</span>
            </button>
          ))}
        </nav>

        <div className="do-sidebar-card">
          <div className="do-sidebar-card-label">Connected</div>
          <div className="do-sidebar-card-value">{dataSources.length} sources</div>
          <div className="do-sidebar-card-meta">API, SQL, Prometheus, Stripe</div>
        </div>
      </aside>

      <main className="mt-main">
        <header className="mt-topbar do-topbar">
          <div>
            <div className="do-live-line">
              <span className="do-live-pill">Live</span>
              <span>Universal data terminal</span>
            </div>
            <h1 className="do-page-title">{currentTitle}</h1>
            <p className="mt-card-subtitle">
              Custom sources, semantic metrics, ChartSpec panels, and market-style real-time display.
            </p>
          </div>

          <div className="mt-toolbar">
            <button
              className="mt-button"
              onClick={() => setTheme((value) => (value === "light" ? "dark" : "light"))}
              type="button"
            >
              {theme === "light" ? "Dark mode" : "Light mode"}
            </button>
            <div className="mt-segmented" role="group" aria-label="Global time range">
              {timeRanges.map((range) => (
                <button
                  className="mt-segment"
                  data-active={activeRange === range.value}
                  key={range.value}
                  onClick={() => setActiveRange(range.value)}
                  type="button"
                >
                  {range.label}
                </button>
              ))}
            </div>
            <button className="mt-button" data-variant="primary" type="button">
              New panel
            </button>
          </div>
        </header>

        {activeSection === "command" || activeSection === "dashboards" ? (
          <DashboardPage
            activeRange={activeRange}
            dashboard={dashboard}
            onSelectPanel={setSelectedPanelId}
            selectedPanelId={selectedPanelId}
          />
        ) : null}
        {activeSection === "datasources" ? <DataSourcesPage dataSources={dataSources} /> : null}
        {activeSection === "metrics" ? <MetricsPage metrics={metrics} dataSources={dataSources} /> : null}
        {activeSection === "alerts" ? <AlertsPage alerts={alerts} /> : null}
        {activeSection === "templates" ? <TemplatesPage templates={templates} /> : null}
        {activeSection === "settings" ? <SettingsPage /> : null}
      </main>

      <Inspector
        activeSection={activeSection}
        dataSources={dataSources}
        metrics={metrics}
        panel={selectedPanel as ChartSpec}
      />
    </div>
  );
}
