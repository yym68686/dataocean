import { dataSources } from "../../../data/seed";
import type { ChartSpec } from "../../../domain/types";
import { usePanelQuery } from "../../../hooks/usePanelQuery";

type StatusCardPanelProps = {
  panel: ChartSpec;
};

export function StatusCardPanel({ panel }: StatusCardPanelProps) {
  const { result } = usePanelQuery(panel);

  return (
    <div>
      <div className="mt-card-header">
        <div>
          <h2 className="mt-card-title">{panel.title}</h2>
          <p className="mt-card-subtitle">{panel.description}</p>
        </div>
      </div>
      <div className="do-status-list">
        {dataSources.slice(0, 3).map((source) => (
          <div className="do-status-row" key={source.id}>
            <div>
              <strong>{source.name}</strong>
              <span>{source.kind} · {source.fields.length} fields</span>
            </div>
            <span className="mt-badge" data-intent={source.status === "live" ? "positive" : undefined}>
              {source.status}
            </span>
          </div>
        ))}
      </div>
      <div className="do-status-footer">
        <span>Freshness</span>
        <strong>{result?.meta.freshness ?? "loading"}</strong>
      </div>
    </div>
  );
}
