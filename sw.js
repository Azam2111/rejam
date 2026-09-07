const CACHE_NAME = 'rejam-v8';
const ASSETS = ['./index.html', './style.css', './app.js', './cloud.js', './firebase-config.js', './manifest.json', './icon-192.png', './icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      // cache:'reload' - brauzerning eski HTTP keshini chetlab o'tib, serverdan yangisini oladi
      cache.addAll(ASSETS.map(u => new Request(u, { cache: 'reload' })))
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Stale-while-revalidate: darhol cache'dan beradi, orqa fonda yangilaydi.
// waitUntil bo'lmasa brauzer SW'ni orqa fon so'rovi tugamasdan o'chirib yuborishi mumkin -
// aynan shu sabab yangi versiya keshga tushmay qolgan edi.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return;

  // Bitta tarmoq so'rovi: uni ham waitUntil, ham respondWith ishlatadi.
  // waitUntil sinxron, hech qanday await'dan oldin chaqiriladi.
  const network = fetch(req).then(res => {
    if (res && res.status === 200 && res.type === 'basic') {
      caches.open(CACHE_NAME).then(c => c.put(req, res.clone())).catch(() => {});
    }
    return res;
  }).catch(() => null);

  event.waitUntil(network);

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(req);
    if (cached) return cached;

    const res = await network;
    if (res) return res;

    if (req.mode === 'navigate') {
      const fallback = await cache.match('./index.html');
      if (fallback) return fallback;
    }
    return Response.error();
  })());
});
