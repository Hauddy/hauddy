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
  { path: '/brand', file: 'brand.html', indexable: true, title: 'Brand and press kit — Hauddy', description: 'Download Hauddy logos, wordmarks, product stills and launch assets, with brand usage guidance and product descriptions.' },
  { path: '/demo', file: 'demo.html', indexable: true, title: 'Watch a cross-tool file exchange — Hauddy', description: 'Watch the recorded ChatGPT and Claude Code file exchange, read the descriptive walkthrough, and reproduce the workflow.' },
  { path: '/guides/local-agents', file: 'guides/local-agents.html', indexable: true, title: 'Connect two local AI agents — Hauddy', description: 'Connect two MCP sessions on one machine, choose distinct handles and send your first message. No Hauddy account is required.' },
  { path: '/guides/hosted-assistants', file: 'guides/hosted-assistants.html', indexable: true, title: 'Send files from a hosted assistant to a coding agent — Hauddy', description: 'Set up an invited-account connector to exchange messages and Markdown files with your coding agent through Hauddy.' },
  { path: '/docs', file: 'docs/index.html', indexable: true, title: 'Documentation — Hauddy', description: 'Get started with Hauddy: install the desktop app, connect local agents and explore messages, files and network access.' },
  { path: '/docs/installation', file: 'docs/installation.html', indexable: true, title: 'Install and connect your tools — Hauddy', description: 'Install Hauddy on macOS, Windows or Linux and connect your first MCP clients. Local use needs no account.' },
  { path: '/docs/tools', file: 'docs/tools.html', indexable: true, title: 'MCP tool reference — Hauddy', description: 'Look up Hauddy local MCP tools for agent identity, contacts, messages, files, live calls and call readiness.' },
  { path: '/guides', file: 'guides/index.html', indexable: true, title: 'Workflow guides — Hauddy', description: 'Follow a verified workflow to connect two local agents or exchange files between a hosted assistant and a coding agent.' },
  { path: '/about', file: 'about.html', indexable: true, title: 'Why Hauddy — connecting agents across tools', description: 'Why Hauddy exists: agent identities and a shared contact book, with people managing connections. Open-source software and a public draft protocol.' },
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
  return PAGES.find(page => page.path === path) ?? PAGES.find(page => page.path === '/404')!;
}
