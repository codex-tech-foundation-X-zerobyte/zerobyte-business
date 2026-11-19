const CACHE_NAME = 'zerobyte-shell-v7'
const scopeUrl = new URL(self.registration.scope)
const BASE_PATH = scopeUrl.pathname.endsWith('/') ? scopeUrl.pathname : `${scopeUrl.pathname}/`
const appUrl = (path) => new URL(path.replace(/^\//, ''), scopeUrl).pathname
const APP_SHELL = ['', 'index.html', 'admin.html', '404.html', 'manifest.webmanifest', 'admin-manifest.webmanifest', 'site.webmanifest', 'favicon.svg', 'favicon.ico', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png', 'logo-mark.png'].map(appUrl)

function isPrivateApi(url) {
  const relativePath = url.pathname.slice(BASE_PATH.length)
  return /^(rest|auth|functions|storage)(\/|$)/.test(relativePath)
}

// A cached copy of a page that was reached through a redirect (for example /admin.html -> /admin) cannot be used to
// answer a page navigation: the browser rejects it and shows a network error. Store a clean copy instead.
async function cleanCopy(response) {
  if (!response.redirected) return response
  return new Response(await response.blob(), { status: response.status, statusText: response.statusText, headers: response.headers })
}

// respondWith() must always receive a real Response. Resolving to undefined is what produced
// "Failed to convert value to 'Response'" when the network was down and nothing was cached.
const offlinePage = () =>
  new Response('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Offline</title><body style="font-family:system-ui;padding:2rem"><h1>You are offline</h1><p>Check your connection and refresh this page.</p></body>', {
    status: 503,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then(async (cache) => {
    await Promise.all(APP_SHELL.map(async (url) => {
      try {
        const response = await fetch(url)
        if (response.ok) await cache.put(url, await cleanCopy(response))
      } catch {
        // An optional shell asset must not prevent the worker from installing.
      }
    }))
  }))
  // Deliberately NOT calling self.skipWaiting() here. A worker that installs
  // while an older one is still controlling the page should sit in
  // "waiting" state so the running app can offer the user an explicit
  // "Update now" choice (see src/lib/pwaUpdate.ts) instead of swapping the
  // app shell out from under them mid-session.
})

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting()
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
    event.respondWith(
      fetch(event.request)
        .then(async (response) => {
          if (response.ok) {
            const copy = await cleanCopy(response.clone())
            void caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy))
          }
          return response
        })
        .catch(async () => {
          const fallback = /\/admin(\.html|\/|$)/.test(url.pathname) ? appUrl('admin.html') : appUrl('index.html')
          return (
            (await caches.match(event.request)) ||
            (await caches.match(fallback)) ||
            (await caches.match(appUrl(''))) ||
            offlinePage()
          )
        }),
    )
    return
  }

  const cacheableAsset = ['script', 'style', 'font', 'image'].includes(event.request.destination)
  if (cacheableAsset) {
    event.respondWith(
      caches.match(event.request).then(
        (cached) =>
          cached ||
          fetch(event.request).then((response) => {
            if (response.ok) {
              const copy = response.clone()
              void caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy))
            }
            return response
          }),
      ),
    )
    return
  }
  event.respondWith(fetch(event.request).catch(async () => (await caches.match(event.request)) || Response.error()))
})
