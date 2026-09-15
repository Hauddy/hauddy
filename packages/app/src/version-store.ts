export const VERSION_MAX_AGE = 15 * 60_000;
export interface VersionResult {
  latest: string | null;
  min: string | null;
  status: "checking" | "success" | "error";
  checkedAt: number | null;
  endpoint: string;
}
export function semverLt(a: string, b: string): boolean {
  const left = a.split(".").map(Number),
    right = b.split(".").map(Number);
  for (let i = 0; i < 3; i++)
    if (left[i] !== right[i]) return left[i] < right[i];
  return false;
}
const valid = (value: unknown): value is string =>
  typeof value === "string" && /^\d+\.\d+\.\d+$/.test(value);

export function createVersionChecker(
  request: typeof fetch = fetch,
  now = Date.now,
) {
  let result: VersionResult | null = null;
  let pending: Promise<void> | null = null;
  let generation = 0;
  let lastAttempt = 0;
  const listeners = new Set<() => void>();
  const publish = (next: VersionResult) => {
    result = next;
    listeners.forEach((fn) => fn());
  };
  return {
    get: () => result,
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    check(endpoint = "https://api.hauddy.com", force = false): Promise<void> {
      const base = endpoint.replace(/^ws/, "http").replace(/\/$/, "");
      const same = result?.endpoint === base;
      if (same && pending) return pending;
      if (
        !force &&
        same &&
        result?.status === "success" &&
        result.checkedAt !== null &&
        now() - result.checkedAt < VERSION_MAX_AGE
      )
        return Promise.resolve();
      if (
        !force &&
        same &&
        result?.status === "error" &&
        now() - lastAttempt < 60_000
      )
        return Promise.resolve();
      const id = ++generation;
      lastAttempt = now();
      const previous = same ? result : null;
      publish({
        latest: previous?.latest ?? null,
        min: previous?.min ?? null,
        checkedAt: previous?.checkedAt ?? null,
        endpoint: base,
        status: "checking",
      });
      pending = (async () => {
        try {
          const response = await request(`${base}/api/version`, {
            signal: AbortSignal.timeout(10_000),
            cache: "no-store",
          });
          if (!response.ok) throw new Error("Version check failed");
          const data = (await response.json()) as {
            latest?: unknown;
            min?: unknown;
          };
          if (
            !valid(data.latest) ||
            !valid(data.min) ||
            semverLt(data.latest, data.min)
          )
            throw new Error("Invalid version response");
          if (id === generation)
            publish({
              latest: data.latest,
              min: data.min,
              checkedAt: now(),
              endpoint: base,
              status: "success",
            });
        } catch {
          if (id === generation)
            publish({
              latest: previous?.latest ?? null,
              min: previous?.min ?? null,
              checkedAt: previous?.checkedAt ?? null,
              endpoint: base,
              status: "error",
            });
        } finally {
          if (id === generation) pending = null;
        }
      })();
      return pending;
    },
  };
}
