import { acquisitionSource, type ACQUISITION_ACTIONS } from '../../protocol/src/acquisition';
const BASE = import.meta.env.VITE_HAUDDY_PLATFORM ?? 'https://api.hauddy.com';
const sent = new Set<string>();
let memorySource: string | undefined;
export function firstSource(fallback = 'landing') {
  if (typeof window === 'undefined') return fallback;
  try {
    const stored = sessionStorage.getItem('hauddy-source');
    if (stored) return acquisitionSource(stored);
  } catch { /* use in-memory attribution when storage is unavailable */ }
  if (!memorySource) memorySource = acquisitionSource(new URLSearchParams(window.location.search).get('utm_source') ?? fallback);
  try { sessionStorage.setItem('hauddy-source', memorySource); } catch { /* optional storage */ }
  return memorySource;
}
export function trackAction(event: typeof ACQUISITION_ACTIONS[number] | 'form_start') {
  const source = firstSource(), key = `hauddy-event:${event}`;
  if (sent.has(key)) return;
  try { if (sessionStorage.getItem(key)) return; } catch { /* optional storage */ }
  sent.add(key);
  void fetch(BASE + '/preregistration/event', { method: 'POST', keepalive: true, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ event, source }) })
    .then(response => { if (!response.ok) throw new Error(); try { sessionStorage.setItem(key, '1'); } catch { /* optional storage */ } })
    .catch(() => { sent.delete(key); });
}
