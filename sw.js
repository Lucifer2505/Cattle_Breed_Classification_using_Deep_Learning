// Service worker: caches the small app shell only. It sits at the site root so its scope covers the whole app
// (on GitHub Pages that is /<repo>/). Model files and split weight chunks are page-managed:
// the page stores them in the Cache API when the user asks, and this worker never downloads them during install.
// Bump VERSION whenever any shell file changes, otherwise returning users keep the old copy.
const VERSION = 'v5';
const SHELL = `cattle-shell-${VERSION}`;
const ENGINE = 'cattle-engine-v1';   // ONNX Runtime files from /vendor/, cached the first time they are used
const MODEL = 'cattle-model-v2';     // owned by js/model-store.js; listed so cleanup never deletes it. Keep in sync with model-config.js.
const KEEP = [SHELL, ENGINE, MODEL];

const SHELL_FILES = [
  './', './index.html', './manifest.webmanifest', './css/style.css',
  './js/app.js', './js/i18n.js', './js/inference.js', './js/model-config.js', './js/model-store.js',
  './js/errors.js', './js/preprocess.js', './js/feedback.js', './js/feedback-config.js',
  './models/classes.json', './assets/icon-192.png', './assets/icon-512.png', './assets/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL)
      .then((c) => c.addAll(SHELL_FILES.map((f) => new Request(f, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('cattle-') && !KEEP.includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;                                   // feedback and any remote model host go straight to the network
  if (/\/models\/cattle_breeds\.onnx(?:\.data(?:\.\d+)?)?$/.test(url.pathname)) return; // page-managed
  if (req.mode === 'navigate') {
    event.respondWith(caches.match('./index.html', { cacheName: SHELL }).then((hit) => hit || fetch(req)));
    return;
  }
  event.respondWith(cacheFirst(req, url.pathname.includes('/vendor/') ? ENGINE : SHELL, url.pathname.includes('/vendor/')));
});

async function cacheFirst(req, cacheName, store) {
  const hit = await caches.match(req, { cacheName, ignoreSearch: true });
  if (hit) return hit;
  const res = await fetch(req);
  if (store && res.status === 200) {
    const copy = res.clone();
    caches.open(cacheName).then((c) => c.put(req, copy)).catch(() => {});      // e.g. quota: still serve the response
  }
  return res;
}
