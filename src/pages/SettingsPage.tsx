import type { AuthUser } from "../domain/types";
import { useI18n } from "../lib/i18n";

type SettingsPageProps = {
  user: AuthUser;
  issuedApiKey?: string;
  onLogout: () => void;
  onRotateApiKey: () => void;
};

export function SettingsPage({ user, issuedApiKey, onLogout, onRotateApiKey }: SettingsPageProps) {
  const { t, te } = useI18n();
  return (
    <section className="mt-grid">
      <article className="mt-card mt-span-6">
        <div className="mt-card-header">
          <div>
            <h2 className="mt-card-title">{t("settings.account")}</h2>
            <p className="mt-card-subtitle">{t("settings.subtitle")}</p>
          </div>
          <button className="mt-button" onClick={onLogout} type="button">
            {t("settings.signOut")}
          </button>
        </div>
        <div className="mt-card-body do-settings-stack">
          <label className="mt-field">
            <span className="mt-label">{t("auth.email")}</span>
            <input className="mt-input" readOnly value={user.email} />
          </label>
          <label className="mt-field">
            <span className="mt-label">{t("settings.role")}</span>
            <input className="mt-input" readOnly value={t("settings.roleValue", { role: te("role", user.role), scope: te("scope", user.apiKeyScope) })} />
          </label>
          <label className="mt-field">
            <span className="mt-label">{t("settings.apiKeyPrefix")}</span>
            <input className="mt-input" readOnly value={`${user.apiKeyPrefix}...`} />
          </label>
          {issuedApiKey ? (
            <label className="mt-field">
              <span className="mt-label">{t("settings.newApiKey")}</span>
              <input className="mt-input" readOnly value={issuedApiKey} />
            </label>
          ) : null}
          <button className="mt-button" onClick={onRotateApiKey} type="button">
            {t("settings.rotateApiKey")}
          </button>
        </div>
      </article>

      <article className="mt-card mt-span-6">
        <div className="mt-card-header">
          <div>
            <h2 className="mt-card-title">{t("settings.roadmap")}</h2>
            <p className="mt-card-subtitle">{t("settings.roadmapSubtitle")}</p>
          </div>
        </div>
        <div className="mt-card-body">
          <ul className="do-roadmap">
            <li>{t("settings.roadmap1")}</li>
            <li>{t("settings.roadmap2")}</li>
            <li>{t("settings.roadmap3")}</li>
            <li>{t("settings.roadmap4")}</li>
            <li>{t("settings.roadmap5")}</li>
          </ul>
        </div>
      </article>
    </section>
  );
}
