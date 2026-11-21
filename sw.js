/**
 * sw.js — Service Worker de Gazapo PWA (jaime312.github.io)
 * 
 * Diseñado para:
 * 1. Estrategia Stale-While-Revalidate para App Shell (HTML, CSS, JS, iconos).
 * 2. Soporte de caché para vídeo multimedia evitando descargas redundantes en bucles.
 * 3. EXCLUSIÓN ESTRICTA: /app-ads.txt y /feed.xml NUNCA se interceptan (pasan directos a red).
 * 4. Actualización limpia e instantánea sin retener usuarios en versiones obsoletas.
 */

const CACHE_NAME = 'gazapo-pwa-v1';
const MEDIA_CACHE_NAME = 'gazapo-media-cache-v1';

const APP_SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'favicon.png',
  'icon-192.png',
  'icon-512.png',
  'og-image.png'
];

// 1. Instalación: precachea el shell básico
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(APP_SHELL).catch((err) => {
        console.warn('[SW] Fallo al precachear algún asset:', err);
      });
    })
  );
});

// 2. Activación: limpiar cachés antiguas y reclamar clientes inmediatamente
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME && key !== MEDIA_CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// 3. Fetch: enrutamiento inteligente
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // REGLA CRÍTICA DE SEGURIDAD:
  // EXCLUIR explícitamente app-ads.txt y feed.xml de cualquier intercepción.
  // Los rastreadores de AdMob y Metricool DEBEN leer siempre el archivo directo del servidor.
  const path = url.pathname.toLowerCase();
  if (
    path === '/app-ads.txt' ||
    path.endsWith('/app-ads.txt') ||
    path === '/feed.xml' ||
    path.endsWith('/feed.xml') ||
    path === '/.nojekyll' ||
    path.endsWith('/.nojekyll')
  ) {
    return; // Pasa directo al servidor sin llamar a event.respondWith
  }

  // Solicitudes no GET: ignorar
  if (req.method !== 'GET') {
    return;
  }

  // Peticiones de vídeo (.mp4): caché temporal para evitar consumo repetido en bucle
  const acceptHeader = req.headers.get('accept') || '';
  if (url.pathname.endsWith('.mp4') || acceptHeader.indexOf('video/') !== -1) {
    // Las peticiones Range no deben ser interceptadas si no tienen respuesta completa
    if (req.headers.has('range')) {
      return;
    }
    event.respondWith(
      caches.open(MEDIA_CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(req);
        if (cached) return cached;
        try {
          const networkResponse = await fetch(req);
          if (networkResponse && networkResponse.status === 200) {
            cache.put(req, networkResponse.clone());
          }
          return networkResponse;
        } catch (_) {
          return cached || new Response('Offline video unavailable', { status: 503 });
        }
      })
    );
    return;
  }

  // App Shell y recursos estáticos: Stale-While-Revalidate
  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(req);
      const networkFetch = fetch(req)
        .then((response) => {
          if (response && response.status === 200 && response.type === 'basic') {
            cache.put(req, response.clone());
          }
          return response;
        })
        .catch(() => cached);

      return cached || networkFetch;
    })
  );
});
