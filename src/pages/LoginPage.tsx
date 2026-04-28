import { type FormEvent, useState } from "react";
import { apiClient, type AuthResponse } from "../api/client";
import type { ThemeMode } from "../domain/types";
import { useI18n } from "../lib/i18n";

type LoginPageProps = {
  theme: ThemeMode;
  onThemeChange: () => void;
  onAuthenticated: (response: AuthResponse) => void;
};

export function LoginPage({ theme, onThemeChange, onAuthenticated }: LoginPageProps) {
  const { t, toggleLocale } = useI18n();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      const response =
        mode === "register"
          ? await apiClient.register({ email, password, name })
          : await apiClient.login({ email, password });
      onAuthenticated(response);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : t("auth.failed"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="do-auth-shell">
      <section className="do-auth-panel">
        <div className="do-auth-brand">
          <span className="mt-brand-mark" aria-hidden="true" />
          <div>
            <h1>DataOcean</h1>
            <p>{t("app.universalTerminal")}</p>
          </div>
        </div>

        <div className="mt-segmented do-auth-tabs" role="group" aria-label={t("auth.mode")}>
          <button
            className="mt-segment"
            data-active={mode === "login"}
            onClick={() => setMode("login")}
            type="button"
          >
            {t("auth.signIn")}
          </button>
          <button
            className="mt-segment"
            data-active={mode === "register"}
            onClick={() => setMode("register")}
            type="button"
          >
            {t("auth.createAccount")}
          </button>
        </div>

        <form className="do-auth-form" onSubmit={(event) => void submit(event)}>
          {mode === "register" ? (
            <label className="mt-field">
              <span className="mt-label">{t("auth.name")}</span>
              <input
                autoComplete="name"
                className="mt-input"
                onChange={(event) => setName(event.target.value)}
                placeholder="DataOcean Admin"
                type="text"
                value={name}
              />
            </label>
          ) : null}

          <label className="mt-field">
              <span className="mt-label">{t("auth.email")}</span>
            <input
              autoComplete="email"
              className="mt-input"
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              required
              type="email"
              value={email}
            />
          </label>

          <label className="mt-field">
              <span className="mt-label">{t("auth.password")}</span>
            <input
              autoComplete={mode === "register" ? "new-password" : "current-password"}
              className="mt-input"
              minLength={8}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={t("auth.passwordPlaceholder")}
              required
              type="password"
              value={password}
            />
          </label>

          {error ? <div className="do-auth-error">{error}</div> : null}

          <button className="mt-button" data-variant="primary" disabled={loading} type="submit">
            {loading ? t("auth.working") : mode === "register" ? t("auth.createAccount") : t("auth.signIn")}
          </button>
        </form>

        <div className="do-auth-footer">
          <span>{mode === "register" ? t("auth.firstUserAdmin") : t("auth.emailPassword")}</span>
          <button className="mt-button" onClick={toggleLocale} type="button">
            {t("app.language")}
          </button>
          <button className="mt-button" onClick={onThemeChange} type="button">
            {theme === "light" ? t("common.darkMode") : t("common.lightMode")}
          </button>
        </div>
      </section>
    </main>
  );
}
