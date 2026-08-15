import { useEffect, useState } from 'react';

const APP_VERSION: string = import.meta.env.VITE_APP_VERSION ?? '0.0.0';

export { APP_VERSION };

export function semverLt(a: string, b: string): boolean {
  const p = (s: string) => s.split('.').slice(0, 3).map(Number);
  const [aM = 0, am = 0, ap = 0] = p(a);
  const [bM = 0, bm = 0, bp = 0] = p(b);
  if (aM !== bM) return aM < bM;
  if (am !== bm) return am < bm;
  return ap < bp;
}

export interface VersionResult {
  latest: string | null;
  min: string | null;
}

let _result: VersionResult | null = null;
let _fetching = false;
const _subs = new Set<(r: VersionResult) => void>();

function _notify(r: VersionResult) {
  _result = r;
  _subs.forEach((fn) => fn(r));
}

/** Kick off a one-shot version fetch from the hub. Safe to call multiple times. */
export function fetchVersion(hubEndpoint: string): void {
  if (_result || _fetching) return;
  _fetching = true;
  const base = hubEndpoint.replace(/^ws/, 'http');
  fetch(`${base}/api/version`)
    .then((r) => r.json() as Promise<{ latest?: string; min?: string }>)
    .then(({ latest = null, min = null }) => _notify({ latest, min }))
    .catch(() => _notify({ latest: null, min: null }));
}

/** React hook — returns the version result (null until the fetch completes). */
export function useVersionResult(): VersionResult | null {
  const [r, setR] = useState<VersionResult | null>(_result);
  useEffect(() => {
    if (_result) setR(_result);
    _subs.add(setR);
    return () => { _subs.delete(setR); };
  }, []);
  return r;
}

export function hasSoftUpdate(): boolean {
  return !!(_result?.latest && semverLt(APP_VERSION, _result.latest));
}

export function hasHardUpdate(): boolean {
  return !!(_result?.min && semverLt(APP_VERSION, _result.min));
}
