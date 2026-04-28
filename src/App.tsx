import { useEffect, useMemo, useRef, useState } from "react";
import { apiClient, clearStoredToken, getStoredToken, setStoredToken, type AuthResponse } from "./api/client";
import { alerts, dashboard, dashboards, dataSources, metrics, templates } from "./data/seed";
import { timeRanges } from "./domain/constants";
import type { AppData, AppSection, AuthUser, ThemeMode, TimeRange } from "./domain/types";
import { AlertsPage } from "./pages/AlertsPage";
import { AdminUsersPage } from "./pages/AdminUsersPage";
import { DashboardPage } from "./pages/DashboardPage";
import { DataSourcesPage } from "./pages/DataSourcesPage";
import { LoginPage } from "./pages/LoginPage";
import { ManualRevenuePage, clearManualRevenuePageCache } from "./pages/ManualRevenuePage";
import { MetricsPage } from "./pages/MetricsPage";
import { TemplatesPage } from "./pages/TemplatesPage";
import { SettingsPage } from "./pages/SettingsPage";
import { Inspector } from "./components/Inspector";
import { setQueryCatalog } from "./services/queryEngine";
import { clearPanelQueryCache } from "./hooks/usePanelQuery";
import { useDisplayCurrency } from "./lib/displayCurrency";
import { useI18n } from "./lib/i18n";

const sections: AppSection[] = [
  "command",
  "datasources",
  "metrics",
  "alerts",
  "templates",
  "settings",
];

const providerSections: AppSection[] = ["provider-zhupay", "provider-creem", "provider-sub2api", "provider-manual"];
const dashboardProviderSections: AppSection[] = ["provider-zhupay", "provider-creem", "provider-sub2api"];
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
  const { t, tx, te, toggleLocale } = useI18n();
  const { displayCurrency, refreshCurrencySettings, setDisplayCurrency, supportedDisplayCurrencies } = useDisplayCurrency();
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
  const [inspectorOpen, setInspectorOpen] = useState(false);
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
  const previousDashboardIdRef = useRef(activeDashboard.id);
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
        clearProviderPageCaches();
        if (!cancelled) {
          setAuthUser(null);
          setAppError(error instanceof Error ? error.message : t("app.restoreFailed"));
        }
      }
    }

    void restoreSession();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const dashboardChanged = previousDashboardIdRef.current !== activeDashboard.id;
    if (!activeDashboard.panels.some((panel) => panel.id === selectedPanelId)) {
      setSelectedPanelId(activeDashboard.panels[0]?.id);
    }
    if (dashboardChanged) {
      setActiveRange(activeDashboard.defaultTimeRange);
      previousDashboardIdRef.current = activeDashboard.id;
    }
  }, [activeDashboard, selectedPanelId]);

  useEffect(() => {
    if (authUser?.role !== "admin" && adminSections.includes(activeSection)) {
      setActiveSection("command");
    }
  }, [activeSection, authUser]);

  useEffect(() => {
    if (authUser) {
      refreshCurrencySettings().catch(() => {
        // Currency settings are display-only; keep local fallback rates if the API is unavailable.
      });
    }
  }, [authUser, refreshCurrencySettings]);

  async function loadAppData() {
    const state = await apiClient.getState();
    setAppData(state);
    setActiveRange(state.dashboard.defaultTimeRange);
    setSelectedPanelId(state.dashboard.panels[4]?.id ?? state.dashboard.panels[0]?.id);
  }

  async function handleAuthenticated(response: AuthResponse) {
    clearProviderPageCaches();
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
    clearProviderPageCaches();
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
      setAppError(error instanceof Error ? error.message : t("settings.rotateFailed"));
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
              <p>{t("app.restoringSession")}</p>
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
  const isDashboardSection = activeSection === "command" || dashboardProviderSections.includes(activeSection) || activeSection === "dashboards";
  const currentTitle = isDashboardSection ? tx(activeDashboard.name) : t(`section.${activeSection}`);
  const inspectorPanel = isDashboardSection ? selectedPanel : undefined;

  return (
    <div className="mt-app do-app" data-inspector-open={inspectorOpen}>
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
              <span>{t(`section.${section}`)}</span>
            </button>
          ))}
        </nav>

        <nav className="mt-nav do-admin-nav" aria-label="Providers">
          <div className="do-nav-heading">{t("nav.providers")}</div>
          {providerSections.map((section) => (
            <button
              className="mt-nav-item do-nav-button"
              data-active={activeSection === section}
              key={section}
              onClick={() => setActiveSection(section)}
              type="button"
            >
              <span className="mt-dot" />
              <span>{t(`section.${section}`)}</span>
            </button>
          ))}
        </nav>

        {isAdmin ? (
          <nav className="mt-nav do-admin-nav" aria-label="Admin">
            <div className="do-nav-heading">{t("nav.admin")}</div>
            {adminSections.map((section) => (
              <button
                className="mt-nav-item do-nav-button"
                data-active={activeSection === section}
                key={section}
                onClick={() => setActiveSection(section)}
                type="button"
              >
                <span className="mt-dot" />
                <span>{t(`section.${section}`)}</span>
              </button>
            ))}
          </nav>
        ) : null}

        <div className="do-sidebar-card">
          <div className="do-sidebar-card-label">{t("sidebar.connected")}</div>
          <div className="do-sidebar-card-value">{t("sidebar.sources", { count: appData.dataSources.length })}</div>
          <div className="do-sidebar-card-meta">{t("sidebar.workspace", { role: te("role", authUser.role) })}</div>
        </div>
      </aside>

      <main className="mt-main">
        <header className="mt-topbar do-topbar">
          <div>
            <div className="do-live-line">
              <span className="do-live-pill">{t("common.live")}</span>
              <span>{appError || t("app.universalTerminal")}</span>
            </div>
            <h1 className="do-page-title">{currentTitle}</h1>
            <p className="mt-card-subtitle">
              {t("app.subtitle")}
            </p>
          </div>

          <div className="mt-toolbar">
            <button className="mt-button" onClick={toggleTheme} type="button">
              {theme === "light" ? t("common.darkMode") : t("common.lightMode")}
            </button>
            <button className="mt-button" onClick={toggleLocale} type="button">
              {t("app.language")}
            </button>
            <div className="mt-segmented" role="group" aria-label={t("app.currency")}>
              {supportedDisplayCurrencies.map((currency) => (
                <button
                  className="mt-segment"
                  data-active={displayCurrency === currency}
                  key={currency}
                  onClick={() => setDisplayCurrency(currency)}
                  type="button"
                >
                  {currency}
                </button>
              ))}
            </div>
            <div className="mt-segmented" role="group" aria-label={t("dashboard.timeRange")}>
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
                {t("app.newPanel")}
              </button>
            ) : null}
            <button className="mt-button do-inspector-toggle" onClick={() => setInspectorOpen((value) => !value)} type="button">
              {inspectorOpen ? t("app.hideContext") : t("app.context")}
            </button>
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
        {activeSection === "provider-manual" ? <ManualRevenuePage /> : null}
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

      {inspectorOpen ? (
        <Inspector
          activeSection={activeSection}
          dataSources={appData.dataSources}
          metrics={appData.metrics}
          panel={inspectorPanel}
        />
      ) : null}
    </div>
  );
}

function clearProviderPageCaches() {
  clearPanelQueryCache();
  clearManualRevenuePageCache();
}

function getDashboardForSection(section: AppSection, dashboards: typeof fallbackAppData.dashboards, fallback: typeof fallbackAppData.dashboard) {
  const dashboardIds: Partial<Record<AppSection, string>> = {
    command: "dashboard-command-center",
    dashboards: "dashboard-command-center",
    "provider-zhupay": "dashboard-zhupay-revenue",
    "provider-creem": "dashboard-creem-revenue",
    "provider-sub2api": "dashboard-sub2api-revenue",
  };
  const dashboardId = dashboardIds[section];

  if (!dashboardId) {
    return fallback;
  }

  return dashboards?.find((dashboardItem) => dashboardItem.id === dashboardId) ?? fallback;
}
