import { useEffect, useState, useSyncExternalStore } from 'react';
import { httpApi, httpStore } from './http';

/**
 * The API surface components code against — the real sidecar daemon
 * (`./http`, http://127.0.0.1:7700). There is no mock: the app shows real
 * local-hub state or an honest "hub not running" state, never sample data.
 */
export const api = httpApi;
const store = httpStore;

// ---- reachability: is the daemon answering? ------------------------------
// Every fetch flips this; `useReachable()` lets the shell show an honest
// "Local hub" vs "Hub not running" state instead of blanking.

let reachable: boolean | null = null; // null = not yet probed
const reachListeners = new Set<() => void>();
function setReachable(next: boolean) {
  if (reachable === next) return;
  reachable = next;
  for (const l of reachListeners) l();
}

export function useReachable(): boolean | null {
  return useSyncExternalStore(
    (cb) => {
      reachListeners.add(cb);
      return () => reachListeners.delete(cb);
    },
    () => reachable,
    () => reachable,
  );
}

/**
 * Re-runs `fetcher` whenever the underlying data changes. The daemon-backed
 * store revalidates on a poll interval and on an explicit bump after each
 * mutation. A failed fetch (daemon down) marks the app unreachable and leaves
 * data `undefined` rather than throwing.
 */
export function useApiData<T>(fetcher: () => Promise<T>, deps: unknown[] = []): T | undefined {
  const version = useSyncExternalStore(store.subscribe, store.getVersion, store.getVersion);
  const [data, setData] = useState<T | undefined>(undefined);
  useEffect(() => {
    let live = true;
    fetcher().then(
      (d) => {
        if (!live) return;
        setReachable(true);
        setData(d);
      },
      () => {
        if (!live) return;
        setReachable(false);
        setData(undefined);
      },
    );
    return () => {
      live = false;
    };
    // fetcher identity is intentionally not a dep — callers inline it
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, ...deps]);
  return data;
}
