const CACHE_NAME = "skillsense-v4";
const APP_SHELL = [
  "./",
  "./index.html",
  "./style.css?v=4",
  "./app.js?v=4",
  "./manifest.json",
  "./icons/icon.svg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;

  if (request.method !== "GET") {
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) {
        return cached;
      }

      return fetch(request).then((response) => {
        const url = new URL(request.url);
        const shouldRuntimeCache =
          url.origin === self.location.origin ||
          url.hostname === "cdn.jsdelivr.net" ||
          url.hostname === "storage.googleapis.com";

        if (shouldRuntimeCache && response.ok) {
          const responseCopy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, responseCopy));
        }

        return response;
      });
    })
  );
});
