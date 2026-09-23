const CACHE_NAME = 'zerobyte-shell-v5'
const scopeUrl = new URL(self.registration.scope)
const BASE_PATH = scopeUrl.pathname.endsWith('/') ? scopeUrl.pathname : `${scopeUrl.pathname}/`
const appUrl = (path) => new URL(path.replace(/^\//, ''), scopeUrl).pathname
const APP_SHELL = ['', 'index.html', 'admin.html', '404.html', 'manifest.webmanifest', 'admin-manifest.webmanifest', 'site.webmanifest', 'favicon.svg', 'icon-192.png', 'icon-512.png'].map(appUrl)

function isPrivateApi(url) {
  const relativePath = url.pathname.slice(BASE_PATH.length)
  return /^(rest|auth|functions|storage)(\/|$)/.test(relativePath)
}

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then(async (cache) => {
    await Promise.all(APP_SHELL.map(async (url) => {
      try {
        await cache.add(url)
      } catch {
        // An optional shell asset must not prevent the worker from installing.
      }
    }))
  }))
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith('zerobyte-shell-') && key !== CACHE_NAME).map((key) => caches.delete(key))),
  ))
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return
  const url = new URL(event.request.url)
  if (!url.pathname.startsWith(BASE_PATH) || isPrivateApi(url)) return

  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).then((response) => {
      if (response.ok) {
        const copy = response.clone()
        void caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy))
      }
      return response
    }).catch(() => {
      const fallback = url.pathname.endsWith('/admin.html') || url.pathname.endsWith('/admin')
        ? appUrl('admin.html')
        : appUrl('index.html')
      return caches.match(event.request).then((response) => response || caches.match(fallback) || caches.match(appUrl('')))
    }))
    return
  }

  const cacheableAsset = ['script', 'style', 'font', 'image'].includes(event.request.destination)
  if (cacheableAsset) {
    event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
      if (response.ok) {
        const copy = response.clone()
        void caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy))
      }
      return response
    })))
    return
  }
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request)))
})
