import { useEffect, useMemo, useRef, useState } from "react";
import type { ChartSpec, QueryResult } from "../domain/types";
import { apiClient } from "../api/client";

type QueryState = {
  result?: QueryResult;
  loading: boolean;
  error?: string;
};

type PanelQueryCacheEntry = {
  result?: QueryResult;
  fetchedAt: number;
  promise?: Promise<QueryResult>;
};

const PANEL_QUERY_CACHE_LIMIT = 200;
const panelQueryCache = new Map<string, PanelQueryCacheEntry>();

export function usePanelQuery(panel: ChartSpec) {
  const panelRef = useRef(panel);
  panelRef.current = panel;
  const refreshInterval = panel.query.refreshIntervalMs;
  const key = useMemo(() => JSON.stringify(panel.query), [panel.query]);
  const [state, setState] = useState<QueryState>(() => getInitialQueryState(key, refreshInterval));

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;

    const cached = getFreshCachedPanelQuery(key, refreshInterval);
    if (cached) {
      setState({ result: cached.result, loading: false });
      timer = window.setTimeout(run, getNextRefreshDelay(cached.fetchedAt, refreshInterval));
    } else {
      const stale = panelQueryCache.get(key);
      if (stale?.result) {
        setState({ result: stale.result, loading: true });
      } else {
        setState({ loading: true });
      }
      void run();
    }

    async function run() {
      try {
        setState((current) => ({ ...current, loading: !current.result }));
        const result = await fetchPanelQuery(panelRef.current, key);
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

    return () => {
      cancelled = true;
      if (timer !== undefined) {
        window.clearTimeout(timer);
      }
    };
  }, [key, refreshInterval]);

  return state;
}

export function clearPanelQueryCache() {
  panelQueryCache.clear();
}

function getInitialQueryState(key: string, refreshInterval: number): QueryState {
  const cached = getFreshCachedPanelQuery(key, refreshInterval);
  if (cached) {
    return { result: cached.result, loading: false };
  }

  const stale = panelQueryCache.get(key);
  if (stale?.result) {
    return { result: stale.result, loading: true };
  }

  return { loading: true };
}

function getFreshCachedPanelQuery(key: string, refreshInterval: number) {
  const cached = panelQueryCache.get(key);
  if (!cached?.result) {
    return undefined;
  }

  return Date.now() - cached.fetchedAt < getCacheTtl(refreshInterval) ? cached : undefined;
}

function getNextRefreshDelay(fetchedAt: number, refreshInterval: number) {
  return Math.max(1000, getCacheTtl(refreshInterval) - (Date.now() - fetchedAt));
}

function getCacheTtl(refreshInterval: number) {
  return Math.max(5000, refreshInterval);
}

async function fetchPanelQuery(panel: ChartSpec, key: string) {
  const cached = panelQueryCache.get(key);
  if (cached?.promise) {
    return cached.promise;
  }

  const promise = apiClient
    .executePanel(panel)
    .then((result) => {
      panelQueryCache.set(key, {
        result,
        fetchedAt: Date.now(),
      });
      trimPanelQueryCache();
      return result;
    })
    .finally(() => {
      const active = panelQueryCache.get(key);
      if (active?.promise === promise) {
        if (active.result) {
          panelQueryCache.set(key, {
            result: active.result,
            fetchedAt: active.fetchedAt,
          });
        } else {
          panelQueryCache.delete(key);
        }
      }
    });

  panelQueryCache.set(key, {
    result: cached?.result,
    fetchedAt: cached?.fetchedAt ?? 0,
    promise,
  });

  return promise;
}

function trimPanelQueryCache() {
  while (panelQueryCache.size > PANEL_QUERY_CACHE_LIMIT) {
    const oldestKey = panelQueryCache.keys().next().value;
    if (!oldestKey) {
      return;
    }
    panelQueryCache.delete(oldestKey);
  }
}
