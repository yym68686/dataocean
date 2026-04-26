import type { ChartSpec } from "../../domain/types";
import { KpiPanel } from "./renderers/KpiPanel";
import { SignalListPanel } from "./renderers/SignalListPanel";
import { StatusCardPanel } from "./renderers/StatusCardPanel";
import { TablePanel } from "./renderers/TablePanel";
import { TimeSeriesPanel } from "./renderers/TimeSeriesPanel";

type PanelRendererProps = {
  panel: ChartSpec;
  selected?: boolean;
  onSelect: () => void;
};

export function PanelRenderer({ panel, selected = false, onSelect }: PanelRendererProps) {
  const className = ["mt-card", "do-panel", `do-span-${panel.layout.w}`, selected ? "is-selected" : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <article className={className} onClick={onSelect}>
      {panel.renderer === "kpi" ? <KpiPanel panel={panel} /> : null}
      {panel.renderer === "lightweight-timeseries" ? <TimeSeriesPanel panel={panel} /> : null}
      {panel.renderer === "signal-list" ? <SignalListPanel panel={panel} /> : null}
      {panel.renderer === "status-card" ? <StatusCardPanel panel={panel} /> : null}
      {panel.renderer === "table" ? <TablePanel panel={panel} /> : null}
    </article>
  );
}
