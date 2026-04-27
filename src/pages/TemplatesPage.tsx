import type { DashboardTemplate } from "../domain/types";

type TemplatesPageProps = {
  templates: DashboardTemplate[];
};

export function TemplatesPage({ templates }: TemplatesPageProps) {
  return (
    <section className="mt-grid">
      {templates.length === 0 ? (
        <article className="mt-card mt-span-12 do-empty-state">
          <h2>No real templates</h2>
          <p>Templates will be added only when they are backed by real source and metric definitions.</p>
        </article>
      ) : null}
      {templates.map((template) => (
        <article className="mt-card mt-span-6 do-template-card" key={template.id}>
          <div>
            <span className="mt-badge">{template.category}</span>
            <h2>{template.name}</h2>
            <p>{template.description}</p>
          </div>
          <div className="do-template-footer">
            <span>{template.panels} panels</span>
            <button className="mt-button" type="button">
              Use template
            </button>
          </div>
        </article>
      ))}
    </section>
  );
}
