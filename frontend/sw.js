// Service Worker Online-First — NON salva mai cartelle cliniche o risposte API nella cache offline
const STATIC_CACHE = "gestionale-rcv-static-v16";
const STATIC_ASSETS = [
  "./assets/styles.css",
  "./assets/body_map.js",
  "./assets/scales.js",
  "./assets/anamnesis.js",
  "./assets/body_chart.png",
  "./assets/body_chart_female.png",
  "./assets/app.js",
  "./assets/logo.png",
  "./assets/icon.svg",
  "./manifest.webmanifest"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(STATIC_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== STATIC_CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  // Esclude tassativamente qualsiasi chiamata API, Supabase o allegato dalla cache offline
  if (
    url.hostname.includes("supabase.co") ||
    url.pathname.includes("/api/") ||
    url.pathname.includes("/attachments/") ||
    event.request.method !== "GET"
  ) {
    return;
  }
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
