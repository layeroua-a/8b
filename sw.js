// Service worker «Наш клас»: офлайн-режим та встановлення як застосунку.
// Сторінка й data.json — спершу мережа (щоб зміни з адмінки приходили одразу),
// без інтернету — остання збережена копія. Іконки — з кешу.
const VERSION = 'v1';
const CACHE = 'klas-' + VERSION;
const CORE = [
  './',
  'data.json',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/maskable-512.png',
  'icons/apple-touch-icon.png',
  'icons/favicon-64.png',
];
const NET_TIMEOUT = 4000;

self.addEventListener('install', (ev) => {
  ev.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (ev) => {
  ev.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('klas-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Ключ кешу без query-рядка: data.json?t=123 і data.json — один запис.
const keyOf = (url) => {
  const u = new URL(url);
  u.search = '';
  u.hash = '';
  if (u.pathname.endsWith('/index.html')) u.pathname = u.pathname.slice(0, -'index.html'.length);
  return u.href;
};

async function networkFirst(req) {
  const key = keyOf(req.url);
  const cache = await caches.open(CACHE);
  // Рядок URL замість req: Request у режимі navigate не можна передавати з init.
  const net = fetch(req.url, { cache: 'no-store', credentials: 'same-origin' }).then((res) => {
    if (res.ok) cache.put(key, res.clone());
    return res;
  });
  net.catch(() => {}); // щоб не було unhandled rejection, якщо переміг таймаут
  try {
    return await Promise.race([
      net,
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), NET_TIMEOUT)),
    ]);
  } catch (err) {
    const hit = (await cache.match(key)) ||
      (req.mode === 'navigate' ? await cache.match(keyOf(self.registration.scope)) : undefined);
    return hit || net; // кешу немає — чекаємо мережу до кінця
  }
}

async function cacheFirst(req) {
  const key = keyOf(req.url);
  const cache = await caches.open(CACHE);
  const hit = await cache.match(key);
  const update = fetch(req).then((res) => {
    if (res.ok) cache.put(key, res.clone());
    return res;
  }).catch(() => null);
  return hit || (await update) || Response.error();
}

self.addEventListener('fetch', (ev) => {
  const req = ev.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Чужі домени (Firebase, GitHub API, Google Drive тощо) не чіпаємо.
  if (url.origin !== self.location.origin) return;

  const path = url.pathname;
  if (req.mode === 'navigate' || path.endsWith('/') || path.endsWith('.html') || path.endsWith('.json') || path.endsWith('.webmanifest')) {
    ev.respondWith(networkFirst(req));
  } else if (path.endsWith('sw.js')) {
    return;
  } else {
    ev.respondWith(cacheFirst(req));
  }
});
