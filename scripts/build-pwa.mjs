// Builds an installable, offline web app for GitHub Pages (or any static host), like Bedrock Math.
//   npm run pwa    -> dist-pwa/
//   npm run site   -> docs/   (what GitHub Pages serves from main / docs)
// Input: dist/index.html from `vite build` (one file: app, data, fonts and the simulation worker).
// Adds a web app manifest, icons, a service worker and its registration. All paths are relative,
// so it works at https://<user>.github.io/<repo>/ as well as at a domain root.
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const root = new URL('..', import.meta.url);
const at = (p) => new URL(p, root);
const OUT = `${(process.argv[2] || 'dist-pwa').replace(/\/+$/, '')}/`;
if (!/^[\w.-]+\/$/.test(OUT)) throw new Error(`Output folder must be a simple folder name, got ${OUT}`);

let html = readFileSync(at('dist/index.html'), 'utf8');
const version = createHash('sha256').update(html).digest('hex').slice(0, 10);

rmSync(at(OUT), { recursive: true, force: true });
mkdirSync(at(OUT + 'icons'), { recursive: true });
const ICONS = ['icon.svg', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png', 'favicon-32.png'];
for (const f of ICONS) copyFileSync(at(`pwa/icons/${f}`), at(`${OUT}icons/${f}`));

const manifest = {
  id: './',
  name: 'ORBIS world scenario lab',
  short_name: 'ORBIS',
  description: 'Run world socio-economic scenarios: TEMPEST macro-financial crises joined with POLIS political instability and turnover.',
  lang: 'en-GB',
  start_url: './',
  scope: './',
  display: 'standalone',
  orientation: 'any',
  background_color: '#eceff0',
  theme_color: '#0f1a1d',
  categories: ['finance', 'education', 'productivity'],
  icons: [
    { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    { src: 'icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }
  ]
};
writeFileSync(at(`${OUT}manifest.webmanifest`), JSON.stringify(manifest, null, 2));

const head = `
    <link rel="manifest" href="manifest.webmanifest" />
    <link rel="icon" href="icons/favicon-32.png" sizes="32x32" />
    <link rel="icon" href="icons/icon.svg" type="image/svg+xml" />
    <link rel="apple-touch-icon" href="icons/apple-touch-icon.png" />
    <meta name="theme-color" content="#0f1a1d" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-title" content="ORBIS" />
    <script>
      if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
        window.addEventListener('load', function () { navigator.serviceWorker.register('./sw.js').catch(function () {}); });
      }
    </script>
  </head>`;
html = html.replace('</head>', head);
writeFileSync(at(`${OUT}index.html`), html);

// Network first for the page (always the newest version when online), cache as the offline fallback.
const assets = ['./', 'index.html', 'manifest.webmanifest', ...ICONS.map((f) => `icons/${f}`)];
writeFileSync(at(`${OUT}sw.js`), `// ORBIS offline support. Version ${version}.
const CACHE = 'orbis-${version}';
const ASSETS = ${JSON.stringify(assets, null, 2)};
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('orbis-') && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put('index.html', copy));
      return res;
    }).catch(() => caches.match('index.html')));
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req)));
});
`);
writeFileSync(at(`${OUT}.nojekyll`), '');
if (OUT === 'docs/') writeFileSync(at(`${OUT}README.md`), 'Built site for GitHub Pages (`npm run site`). Do not edit by hand: the source is in `src/`.\n');
console.log(`${OUT}: index.html (${(html.length / 1024).toFixed(0)} KB), manifest, icons, sw.js (version ${version})`);
