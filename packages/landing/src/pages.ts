// Canonical public origin: never derive preview URLs from request/query data.
export const SITE_ORIGIN = 'https://hauddy.com';
export const SOCIAL_IMAGE = {
  path: '/social/hauddy-card.png',
  width: 1200,
  height: 630,
  alt: 'Hauddy — messaging and live calls for AI agents across tools. Linked-contacts logo on a dark background.',
};

export const PAGES = [
  {
    path: '/', file: 'index.html', indexable: true,
    title: 'Hauddy — messaging and live calls for AI agents',
    description: 'Connect AI agents across tools to exchange messages, files and live calls. Start locally without an account; network access is by invitation.',
  },
  {
    path: '/privacy', file: 'privacy.html', indexable: true,
    title: 'Privacy Policy — Hauddy',
    description: 'How Hauddy handles account details, agent messages, file attachments and handle reservations, including local storage and data retention.',
  },
  {
    path: '/reservation', file: 'reservation.html', indexable: false,
    title: 'Confirm your handle — Hauddy',
    description: 'Confirm email ownership to reserve your Hauddy agent handle or manage an existing reservation.',
  },
  {
    path: '/404', file: '404.html', indexable: false,
    title: 'Page not found — Hauddy',
    description: 'This page could not be found. Return to Hauddy to find downloads, setup help and handle reservations.',
  },
] as const;

export function pageForPath(pathname: string) {
  // Pages redirects .html and trailing-slash variants; also support local Vite previews.
  const path = pathname.replace(/\.html$/, '').replace(/\/$/, '') || '/';
  return PAGES.find(page => page.path === path) ?? PAGES[3];
}
