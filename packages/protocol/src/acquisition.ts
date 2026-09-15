/** Reviewed source labels encode channel + medium + campaign; never store arbitrary query text. */
export const ACQUISITION_CAMPAIGNS = ['github_release_alpha', 'discord_community_alpha', 'glama_directory_alpha'] as const;
export const ACQUISITION_ACTIONS = ['page_view', 'download_click', 'demo_play', 'guide_open'] as const;
export const ACQUISITION_EVENTS = ['form_start', 'request', 'verification', 'verified_reservation', 'invitation', 'claim', 'activation', ...ACQUISITION_ACTIONS] as const;
export function acquisitionSource(raw: unknown, extra = ''): string {
  const allowed = ['hero', 'closing', 'landing', ...ACQUISITION_CAMPAIGNS, ...extra.split(',').map(s => s.trim())];
  return typeof raw === 'string' && /^[a-zA-Z0-9_-]{1,48}$/.test(raw) && allowed.includes(raw) ? raw : 'campaign';
}
