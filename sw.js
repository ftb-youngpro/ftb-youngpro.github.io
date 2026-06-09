/*
  Young Pro Ministry — service worker
  Faith Temple Baptist Church Inc.

  GitHub Pages USER SITE served at the root, so this file at /sw.js gets root scope.
  Goal: installable + offline-capable, pure static, no build step.

  Strategy
  --------
  - install : precache the core app shell (cache-bust safe via the versioned name).
  - fetch   : same-origin GET -> cache-first with a network fallback; navigations get
              an offline fallback to the cached home page. Cross-origin (Google Fonts,
              the GSAP jsDelivr CDN) is left untouched and goes straight to the network.
  - activate: drop caches from older versions, then take control of open clients.

  Bump CACHE_VERSION whenever the shell assets change so clients pick up fresh files.
*/

const CACHE_VERSION = "yp-cache-v2";

/*
  Core shell that must be present for the precache to succeed. Every entry here is a
  file that exists today; if any 404'd, cache.addAll() would reject and the whole
  install would fail — so keep this list to known-good assets only.
*/
const CORE_ASSETS = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/assets/css/styles.css",
  "/assets/css/animations.css",
  "/assets/css/chatbot.css",
  "/assets/js/main.js",
  "/assets/js/chatbot.js",
  // The chatbot manifest: loaded lazily on first chat-open, but precaching it
  // makes the FAQ helper work offline from the very first interaction.
  "/assets/data/kb/index.json",
  "/assets/img/yp-mark.svg",
  "/assets/img/yp-logo.svg",
  "/favicon.svg",
  "/assets/img/icon-192.png",
  "/assets/img/icon-512.png",
  // The 4 upcoming-event posters, so the happenings cards work offline.
  "/assets/img/ypf-malasakit-06-14-2026.jpg",
  "/assets/img/ypgt-cooking-06-20-2026.jpg",
  "/assets/img/ypf-bahala-na-07-12-2026.jpg",
  "/assets/img/ypgt-hobby-fitness-07-18-2026.jpg",
];

/*
  Pages that are part of the shell but may not exist yet (added in a later pass).
  These are cached opportunistically with individual, fault-tolerant requests so a
  missing file never aborts install. Once the pages ship, they precache automatically.
*/
const OPTIONAL_ASSETS = [
  "/events.html",
  "/devotionals.html",
  "/faq.html",
  // Chatbot knowledge-base segments — fetched lazily per query, but best-effort
  // precached here so the bilingual FAQ helper answers fully offline. A missing
  // file is tolerated individually (the engine degrades to its email fallback).
  "/assets/data/kb/identity.json",
  "/assets/data/kb/who-can-join.json",
  "/assets/data/kb/first-visit.json",
  "/assets/data/kb/schedule.json",
  "/assets/data/kb/events.json",
  "/assets/data/kb/themes.json",
  "/assets/data/kb/leaders.json",
  "/assets/data/kb/church-beliefs.json",
  "/assets/data/kb/spiritual.json",
  "/assets/data/kb/location-local.json",
  "/assets/data/kb/contact-app.json",
  "/assets/data/kb/professionals-seo.json",
];

// The page we fall back to when a navigation request can't be served from network or cache.
const OFFLINE_URL = "/index.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_VERSION);
      // Required shell: must all succeed.
      await cache.addAll(CORE_ASSETS);
      // Optional shell: best-effort, tolerate 404s individually.
      await Promise.all(
        OPTIONAL_ASSETS.map((url) =>
          cache.add(new Request(url, { cache: "reload" })).catch(() => {})
        )
      );
      // Activate this worker as soon as it finishes installing.
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.map((key) => (key === CACHE_VERSION ? null : caches.delete(key)))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Only handle GET; everything else goes straight to the network.
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Never touch cross-origin requests (Google Fonts, GSAP CDN, analytics, etc.).
  if (url.origin !== self.location.origin) return;

  // Navigations: network-first so content stays fresh, with a cached-page fallback offline.
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const networkResponse = await fetch(request);
          // Keep the visited page warm in the cache for next time offline.
          const cache = await caches.open(CACHE_VERSION);
          cache.put(request, networkResponse.clone());
          return networkResponse;
        } catch (err) {
          const cache = await caches.open(CACHE_VERSION);
          const cached =
            (await cache.match(request)) ||
            (await cache.match(OFFLINE_URL)) ||
            (await cache.match("/"));
          // If even the offline page isn't cached, surface a minimal offline response.
          return (
            cached ||
            new Response(
              "<!doctype html><meta charset=utf-8><title>Offline</title><body style=\"font-family:system-ui;background:#07120d;color:#e8f3ee;display:grid;place-items:center;height:100vh;margin:0\"><p>You're offline. Reconnect to load the Young Pro Ministry site.</p>",
              { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } }
            )
          );
        }
      })()
    );
    return;
  }

  // All other same-origin GETs: cache-first, fall back to network, then cache the result.
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_VERSION);
      const cached = await cache.match(request);
      if (cached) return cached;

      try {
        const networkResponse = await fetch(request);
        // Only cache complete, same-origin "basic" 200s (skip opaque/partial responses).
        if (
          networkResponse &&
          networkResponse.status === 200 &&
          networkResponse.type === "basic"
        ) {
          cache.put(request, networkResponse.clone());
        }
        return networkResponse;
      } catch (err) {
        // Last resort for a failed sub-resource fetch: whatever we may have cached.
        return (await cache.match(request)) || Response.error();
      }
    })()
  );
});
