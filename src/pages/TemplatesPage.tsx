import type { DashboardTemplate } from "../domain/types";

type TemplatesPageProps = {
  templates: DashboardTemplate[];
};

export function TemplatesPage({ templates }: TemplatesPageProps) {
  return (
    <section className="mt-grid">
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
