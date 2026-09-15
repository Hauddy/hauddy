import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { build } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
await build({ root });
// Build the same React components for Node in a disposable directory.
// Keeping this under node_modules lets external React imports resolve normally.
const serverDir = await mkdtemp(resolve(root, '../../node_modules/.landing-prerender-'));
try {
  await build({ root, publicDir: false, build: {
    ssr: 'src/entry-server.tsx', outDir: serverDir, emptyOutDir: true,
    rollupOptions: { output: { entryFileNames: 'entry-server.mjs' } },
  } });
  const { render, PAGES, SITE_ORIGIN, SOCIAL_IMAGE } = await import(pathToFileURL(resolve(serverDir, 'entry-server.mjs')).href);
  const template = await readFile(resolve(root, 'dist/index.html'), 'utf8');
  const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const meta = (name, value, property = false) => `    <meta ${property ? 'property' : 'name'}="${name}" content="${escape(value)}" />`;
  for (const page of PAGES) {
    const url = SITE_ORIGIN + page.path;
    const tags = [
      `    <title>${escape(page.title)}</title>`,
      meta('description', page.description),
      meta('robots', page.indexable ? 'index, follow' : 'noindex, nofollow, noarchive'),
    ];
    if (page.path !== '/404') tags.push(`    <link rel="canonical" href="${url}" />`);
    if (page.indexable) {
      tags.push(
        meta('og:title', page.title, true), meta('og:description', page.description, true),
        meta('og:type', 'website', true), meta('og:site_name', 'Hauddy', true), meta('og:url', url, true),
        meta('og:image', SITE_ORIGIN + SOCIAL_IMAGE.path, true), meta('og:image:type', 'image/png', true),
        meta('og:image:width', SOCIAL_IMAGE.width, true), meta('og:image:height', SOCIAL_IMAGE.height, true),
        meta('og:image:alt', SOCIAL_IMAGE.alt, true),
        meta('twitter:card', 'summary_large_image'), meta('twitter:title', page.title),
        meta('twitter:description', page.description), meta('twitter:image', SITE_ORIGIN + SOCIAL_IMAGE.path),
        meta('twitter:image:alt', SOCIAL_IMAGE.alt),
      );
    } else {
      tags.push(meta('referrer', 'no-referrer'));
    }
    const html = template.replace(/    <!-- page-metadata:start -->[\s\S]*?    <!-- page-metadata:end -->/, tags.join('\n'))
      .replace('<div id="root"></div>', `<div id="root">${render(page.path)}</div>`);
    await writeFile(resolve(root, 'dist', page.file), html);
  }
  const urls = PAGES.filter(page => page.indexable).map(page => `  <url><loc>${SITE_ORIGIN}${page.path}</loc></url>`);
  await writeFile(resolve(root, 'dist/sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`);
  // Let crawlers fetch action pages so they can observe noindex. Not access control.
  await writeFile(resolve(root, 'dist/robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${SITE_ORIGIN}/sitemap.xml\n`);
  console.log(`Prerendered ${PAGES.length} routes, robots.txt and sitemap.xml`);
} finally {
  await rm(serverDir, { recursive: true, force: true });
}
