/* Minimal service worker so Chromium can treat the site as installable (manifest + SW scope). */
self.addEventListener('install', function (event) {
  self.skipWaiting();
});
self.addEventListener('activate', function (event) {
  event.waitUntil(self.clients.claim());
});
self.addEventListener('fetch', function (event) {
  event.respondWith(fetch(event.request));
});
