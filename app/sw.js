// 4FLORENTINE — service worker
// Réseau d'abord pour tout le code de l'application : une nouvelle version publiée
// est visible dès l'ouverture suivante ; le cache ne sert qu'en cas de coupure réseau.
const CACHE = 'fl-app-2.2.0';
const SHELL = [
  './', './index.html', './app.css?v=2.2.0', './app.js?v=2.2.0', './i18n.js', './manifest.webmanifest',
  '../assets/ds/tokens.css?v=2.2.0', '../assets/ds/components.css?v=2.2.0', '../assets/ds/icons.js',
  '../assets/js/core.js', '../assets/js/config.js', '../assets/vendor/supabase-2.119.0.js',
  '../assets/fonts/fonts.css', '../assets/brand/emblem.webp', '../assets/brand/logo-512.webp', '../assets/brand/icon-192.png',
];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // Les données (Supabase, Hebcal) ne sont jamais mises en cache par le service worker.
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' })
      .then(res => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); } return res; })
      .catch(() => caches.match(e.request, { ignoreSearch: false }).then(r => r || caches.match('./index.html')))
  );
});
