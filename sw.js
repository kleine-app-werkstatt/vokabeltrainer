// Offline-Cache. Bei jeder neuen Version VERSION erhöhen.
const VERSION = 'v7';
const CORE = ['./', 'index.html', 'styles.css', 'app.js', 'manifest.webmanifest',
  'icons/icon-180.png', 'icons/icon-192.png', 'fonts/nunito-latin-wght-normal.woff2', 'fonts/nunito-latin-ext-wght-normal.woff2', 'vendor/tesseract/tesseract.min.js'];
const OCR = ['vendor/tesseract/worker.min.js', 'vendor/tesseract/core/tesseract-core-simd-lstm.wasm.js',
  'vendor/tesseract/core/tesseract-core-lstm.wasm.js'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim())
    .then(() => caches.open(VERSION).then((c) => c.addAll(OCR)).catch(() => {})));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  const isApp = /\/(index\.html|app\.js|styles\.css)?$/.test(new URL(req.url).pathname);
  if (isApp || req.mode === 'navigate') {
    // App-Dateien: erst Netz (für Updates), sonst Cache
    e.respondWith(fetch(req).then((res) => { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); return res; })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('index.html'))));
    return;
  }
  // Alles andere (Texterkennung, Sprachdaten, Icons): erst Cache
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
    return res;
  })));
});
