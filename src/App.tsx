import { useEffect, useMemo, useState } from "react";
import { apiClient, clearStoredToken, getStoredToken, setStoredToken, type AuthResponse } from "./api/client";
import { alerts, dashboard, dashboards, dataSources, metrics, templates } from "./data/seed";
import { sectionLabels, timeRanges } from "./domain/constants";
import type { AppData, AppSection, AuthUser, ThemeMode, TimeRange } from "./domain/types";
import { AlertsPage } from "./pages/AlertsPage";
import { AdminUsersPage } from "./pages/AdminUsersPage";
import { DashboardPage } from "./pages/DashboardPage";
import { DataSourcesPage } from "./pages/DataSourcesPage";
import { LoginPage } from "./pages/LoginPage";
import { MetricsPage } from "./pages/MetricsPage";
import { TemplatesPage } from "./pages/TemplatesPage";
import { SettingsPage } from "./pages/SettingsPage";
import { Inspector } from "./components/Inspector";
import { setQueryCatalog } from "./services/queryEngine";

const sections: AppSection[] = [
  "command",
  "datasources",
  "metrics",
  "alerts",
  "templates",
  "settings",
];

const providerSections: AppSection[] = ["provider-zhupay", "provider-creem"];
const adminSections: AppSection[] = ["admin-users"];

const fallbackAppData: AppData = {
  dataSources,
  metrics,
  dashboard,
  dashboards,
  alerts,
  templates,
};

export default function App() {
  const [activeSection, setActiveSection] = useState<AppSection>("command");
  const [theme, setTheme] = useState<ThemeMode>(() => {
    const stored = window.localStorage.getItem("dataocean-theme");
    if (stored === "light" || stored === "dark") {
      return stored;
    }
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });
  const [authUser, setAuthUser] = useState<AuthUser | null | undefined>(undefined);
  const [appData, setAppData] = useState<AppData>(fallbackAppData);
  const [issuedApiKey, setIssuedApiKey] = useState<string | undefined>();
  const [appError, setAppError] = useState("");
  const [activeRange, setActiveRange] = useState<TimeRange>(fallbackAppData.dashboard.defaultTimeRange);
  const [selectedPanelId, setSelectedPanelId] = useState(
    fallbackAppData.dashboard.panels[4]?.id ?? fallbackAppData.dashboard.panels[0]?.id,
  );

  const dashboards = useMemo(
    () => (appData.dashboards?.length ? appData.dashboards : [appData.dashboard]),
    [appData.dashboard, appData.dashboards],
  );
  const activeDashboard = useMemo(
    () => getDashboardForSection(activeSection, dashboards, appData.dashboard),
    [activeSection, appData.dashboard, dashboards],
  );
  const selectedPanel = useMemo(
    () => activeDashboard.panels.find((panel) => panel.id === selectedPanelId) ?? activeDashboard.panels[0],
    [activeDashboard.panels, selectedPanelId],
  );

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    window.localStorage.setItem("dataocean-theme", theme);
  }, [theme]);

  useEffect(() => {
    setQueryCatalog({ dataSources: appData.dataSources, metrics: appData.metrics });
  }, [appData.dataSources, appData.metrics]);

  useEffect(() => {
    let cancelled = false;
    const token = getStoredToken();

    if (!token) {
      setAuthUser(null);
      return;
    }

    async function restoreSession() {
      try {
        const [{ user }, state] = await Promise.all([apiClient.me(), apiClient.getState()]);
        if (!cancelled) {
          setAuthUser(user);
          setAppData(state);
          setActiveRange(state.dashboard.defaultTimeRange);
          setSelectedPanelId(state.dashboard.panels[4]?.id ?? state.dashboard.panels[0]?.id);
        }
      } catch (error) {
        clearStoredToken();
        if (!cancelled) {
          setAuthUser(null);
          setAppError(error instanceof Error ? error.message : "Could not restore session");
        }
      }
    }

    void restoreSession();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!activeDashboard.panels.some((panel) => panel.id === selectedPanelId)) {
      setSelectedPanelId(activeDashboard.panels[0]?.id);
      setActiveRange(activeDashboard.defaultTimeRange);
    }
  }, [activeDashboard, selectedPanelId]);

  useEffect(() => {
    if (authUser?.role !== "admin" && adminSections.includes(activeSection)) {
      setActiveSection("command");
    }
  }, [activeSection, authUser]);

  async function loadAppData() {
    const state = await apiClient.getState();
    setAppData(state);
    setActiveRange(state.dashboard.defaultTimeRange);
    setSelectedPanelId(state.dashboard.panels[4]?.id ?? state.dashboard.panels[0]?.id);
  }

  async function handleAuthenticated(response: AuthResponse) {
    setStoredToken(response.token);
    setAuthUser(response.user);
    setIssuedApiKey(response.apiKey);
    setAppError("");
    await loadAppData();
  }

  async function handleLogout() {
    try {
      await apiClient.logout();
    } catch {
      // Local logout should still clear the browser session if the API call fails.
    }
    clearStoredToken();
    setAuthUser(null);
    setIssuedApiKey(undefined);
  }

  async function handleRotateApiKey() {
    try {
      const result = await apiClient.rotateApiKey();
      setAuthUser(result.user);
      setIssuedApiKey(result.apiKey);
      setAppError("");
    } catch (error) {
      setAppError(error instanceof Error ? error.message : "Could not rotate API key");
    }
  }

  function toggleTheme() {
    setTheme((value) => (value === "light" ? "dark" : "light"));
  }

  if (authUser === undefined) {
    return (
      <main className="do-auth-shell">
        <section className="do-auth-panel">
          <div className="do-auth-brand">
            <span className="mt-brand-mark" aria-hidden="true" />
            <div>
              <h1>DataOcean</h1>
              <p>Restoring session...</p>
            </div>
          </div>
        </section>
      </main>
    );
  }

  if (authUser === null) {
    return <LoginPage theme={theme} onThemeChange={toggleTheme} onAuthenticated={(response) => void handleAuthenticated(response)} />;
  }

  const isAdmin = authUser.role === "admin";
  const isDashboardSection = activeSection === "command" || providerSections.includes(activeSection) || activeSection === "dashboards";
  const currentTitle = isDashboardSection ? activeDashboard.name : sectionLabels[activeSection];
  const inspectorPanel = isDashboardSection ? selectedPanel : undefined;

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

        <nav className="mt-nav do-admin-nav" aria-label="Providers">
          <div className="do-nav-heading">Providers</div>
          {providerSections.map((section) => (
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

        {isAdmin ? (
          <nav className="mt-nav do-admin-nav" aria-label="Admin">
            <div className="do-nav-heading">Admin</div>
            {adminSections.map((section) => (
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
        ) : null}

        <div className="do-sidebar-card">
          <div className="do-sidebar-card-label">Connected</div>
          <div className="do-sidebar-card-value">{appData.dataSources.length} sources</div>
          <div className="do-sidebar-card-meta">{authUser.role} workspace</div>
        </div>
      </aside>

      <main className="mt-main">
        <header className="mt-topbar do-topbar">
          <div>
            <div className="do-live-line">
              <span className="do-live-pill">Live</span>
              <span>{appError || "Universal data terminal"}</span>
            </div>
            <h1 className="do-page-title">{currentTitle}</h1>
            <p className="mt-card-subtitle">
              Custom sources, semantic metrics, ChartSpec panels, and market-style real-time display.
            </p>
          </div>

          <div className="mt-toolbar">
            <button className="mt-button" onClick={toggleTheme} type="button">
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
            {isAdmin ? (
              <button className="mt-button" data-variant="primary" type="button">
                New panel
              </button>
            ) : null}
          </div>
        </header>

        {isDashboardSection ? (
          <DashboardPage
            activeRange={activeRange}
            dashboard={activeDashboard}
            dataSources={appData.dataSources}
            metrics={appData.metrics}
            onSelectPanel={setSelectedPanelId}
            selectedPanelId={selectedPanelId}
            theme={theme}
          />
        ) : null}
        {activeSection === "datasources" ? <DataSourcesPage dataSources={appData.dataSources} /> : null}
        {activeSection === "metrics" ? <MetricsPage metrics={appData.metrics} dataSources={appData.dataSources} /> : null}
        {activeSection === "alerts" ? <AlertsPage alerts={appData.alerts} /> : null}
        {activeSection === "templates" ? <TemplatesPage templates={appData.templates} /> : null}
        {activeSection === "admin-users" && isAdmin ? <AdminUsersPage currentUser={authUser} /> : null}
        {activeSection === "settings" ? (
          <SettingsPage
            issuedApiKey={issuedApiKey}
            onLogout={() => void handleLogout()}
            onRotateApiKey={() => void handleRotateApiKey()}
            user={authUser}
          />
        ) : null}
      </main>

      <Inspector
        activeSection={activeSection}
        dataSources={appData.dataSources}
        metrics={appData.metrics}
        panel={inspectorPanel}
      />
    </div>
  );
}

function getDashboardForSection(section: AppSection, dashboards: typeof fallbackAppData.dashboards, fallback: typeof fallbackAppData.dashboard) {
  const dashboardIds: Partial<Record<AppSection, string>> = {
    command: "dashboard-command-center",
    dashboards: "dashboard-command-center",
    "provider-zhupay": "dashboard-zhupay-revenue",
    "provider-creem": "dashboard-creem-revenue",
  };
  const dashboardId = dashboardIds[section];

  if (!dashboardId) {
    return fallback;
  }

  return dashboards?.find((dashboardItem) => dashboardItem.id === dashboardId) ?? fallback;
}
