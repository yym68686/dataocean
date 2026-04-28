import type { DashboardTemplate } from "../domain/types";
import { useI18n } from "../lib/i18n";

type TemplatesPageProps = {
  templates: DashboardTemplate[];
};

export function TemplatesPage({ templates }: TemplatesPageProps) {
  const { t, tx } = useI18n();
  return (
    <section className="mt-grid">
      {templates.length === 0 ? (
        <article className="mt-card mt-span-12 do-empty-state">
          <h2>{t("templates.emptyTitle")}</h2>
          <p>{t("templates.emptyText")}</p>
        </article>
      ) : null}
      {templates.map((template) => (
        <article className="mt-card mt-span-6 do-template-card" key={template.id}>
          <div>
            <span className="mt-badge">{tx(template.category)}</span>
            <h2>{tx(template.name)}</h2>
            <p>{tx(template.description)}</p>
          </div>
          <div className="do-template-footer">
            <span>{t("templates.panels", { count: template.panels })}</span>
            <button className="mt-button" type="button">
              {t("templates.use")}
            </button>
          </div>
        </article>
      ))}
    </section>
  );
}
