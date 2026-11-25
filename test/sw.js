// Offline-Cache. Bei jeder neuen Version VERSION erhöhen.
// Der Cache-Name enthält den Pfad, damit sich Test- und Echtversion (und andere Apps
// auf derselben Domain) nicht gegenseitig die Caches löschen.
const SCOPE = new URL(self.registration.scope).pathname; // z. B. /vokabeltrainer/ oder /vokabeltrainer/test/
const VERSION = SCOPE + 'v16';
// Eigene ältere Caches dieser Version (oder alte Namen wie 'v9') – nie die einer anderen App/Version
const isOwnOldCache = (k) => k !== VERSION && ((k.startsWith(SCOPE) && !k.slice(SCOPE.length).includes('/')) || /^v\d+$/.test(k));
const CORE = ['./', 'index.html', 'styles.css', 'app.js', 'manifest.webmanifest',
  'icons/icon-180.png', 'icons/icon-192.png', 'fonts/nunito-latin-wght-normal.woff2', 'fonts/nunito-latin-ext-wght-normal.woff2', 'vendor/tesseract/tesseract.min.js'];
const OCR = ['vendor/tesseract/worker.min.js', 'vendor/tesseract/core/tesseract-core-simd-lstm.wasm.js',
  'vendor/tesseract/core/tesseract-core-lstm.wasm.js'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter(isOwnOldCache).map((k) => caches.delete(k))))
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
