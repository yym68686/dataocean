import { useEffect, useMemo, useState } from "react";
import type { ChartSpec, QueryResult } from "../domain/types";
import { queryEngine } from "../services/queryEngine";

type QueryState = {
  result?: QueryResult;
  loading: boolean;
  error?: string;
};

export function usePanelQuery(panel: ChartSpec) {
  const [state, setState] = useState<QueryState>({ loading: true });
  const refreshInterval = panel.query.refreshIntervalMs;
  const key = useMemo(() => JSON.stringify(panel.query), [panel.query]);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;

    async function run() {
      try {
        setState((current) => ({ ...current, loading: !current.result }));
        const result = await queryEngine.executePanel(panel);
        if (!cancelled) {
          setState({ result, loading: false });
        }
      } catch (error) {
        if (!cancelled) {
          setState({
            loading: false,
            error: error instanceof Error ? error.message : "Unknown query error",
          });
        }
      }

      if (!cancelled) {
        timer = window.setTimeout(run, refreshInterval);
      }
    }

    run();

    return () => {
      cancelled = true;
      if (timer !== undefined) {
        window.clearTimeout(timer);
      }
    };
  }, [key, panel, refreshInterval]);

  return state;
}
