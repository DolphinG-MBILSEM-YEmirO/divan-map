/**
 * Service worker: lets the site open without a connection after one visit.
 *
 * Strategy: network first for every same-origin GET, so a visitor online always gets the latest files and the
 * copy in the cache is refreshed; the cached copy is used only when the network fails. Never cached:
 *   - /api/ (the AI assistant; its answers must not be stored),
 *   - other origins (OpenStreetMap tiles stay with OpenStreetMap, per its tile usage policy).
 * Change CACHE_VERSION when the precache list changes; old caches are deleted on activation.
 * tools/smoke-test.mjs checks that every path in PRECACHE exists.
 */
const CACHE_VERSION = 'dlt-v1';

const PRECACHE = [
  './',
  'index.html',
  'game.html',
  'manifest.webmanifest',
  'css/styles.css', 'css/opening.css', 'css/caravan.css', 'css/sidebar.css', 'css/game.css',
  'vendor/leaflet/leaflet.css', 'vendor/leaflet/leaflet.js',
  'js/main.js', 'js/sidebar.js', 'js/game.js', 'js/game-board.js', 'js/game-rules.js', 'js/caravan.js',
  'js/activity.js', 'js/assistant.js', 'js/cardparts.js', 'js/explain.js', 'js/intro.js', 'js/labels-list.js',
  'js/labels.js', 'js/maps.js', 'js/modern-layer.js', 'js/quiz.js', 'js/research.js', 'js/storage.js',
  'js/text.js', 'js/ui.js', 'js/pwa.js', 'js/i18n.js', 'js/i18n-en.js',
  'data/config.json', 'data/places.json', 'data/sources.json', 'data/glossary.json', 'data/quiz.json',
  'data/map-annotations.json', 'data/modern-equivalents.json', 'data/modern-geo.json', 'data/caravan.json',
  'data/game.json', 'data/research-instruments.json',
  'assets/school-logo.jpg', 'assets/original-map.jpg', 'assets/turkish-redraw-map.webp', 'assets/icon-192.png',
];

self.addEventListener('install', (event) => {
  // Each file on its own, so one missing file does not stop the rest from being stored.
  event.waitUntil(caches.open(CACHE_VERSION).then((cache) => Promise.all(PRECACHE.map((path) => cache.add(path).catch(() => null)))));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  event.respondWith((async () => {
    try {
      const response = await fetch(request);
      if (response.ok && response.type === 'basic') {
        const copy = response.clone();
        caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy)).catch(() => {});
      }
      return response;
    } catch (error) {
      const cached = await caches.match(request, { ignoreSearch: request.mode === 'navigate' });
      if (cached) return cached;
      if (request.mode === 'navigate') {
        const page = url.pathname.endsWith('game.html') ? 'game.html' : 'index.html';
        const fallback = await caches.match(page);
        if (fallback) return fallback;
      }
      throw error;
    }
  })());
});
