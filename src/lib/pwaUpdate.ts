import { appPath, getBasePath } from './routing'

// Real PWA update lifecycle, replacing the previous silent
// self.skipWaiting()-on-install behavior (see public/sw.js).
//
// Flow:
// 1. registerServiceWorker() registers the worker and starts watching it.
// 2. When a new worker finishes installing WHILE an existing worker is
//    already controlling the page (i.e. this is an update, not the first
//    install), every subscriber is notified that an update is ready.
// 3. The UI (see the UpdateBanner component wired up in App.tsx) shows an
//    "Update now" / "Later" prompt. "Update now" calls applyUpdate(), which
//    tells the waiting worker to skip waiting; once it takes control we
//    reload the page once to pick up the new app shell.
// 4. "Later" just dismisses the banner -- the update is already downloaded
//    and cached, so it activates automatically next time every tab of the
//    app is closed and reopened, with no data loss risk in the meantime.

type UpdateListener = (available: boolean) => void

let registration: ServiceWorkerRegistration | null = null
let updateAvailable = false
const listeners = new Set<UpdateListener>()

function notify() {
  for (const listener of listeners) listener(updateAvailable)
}

function watchRegistration(reg: ServiceWorkerRegistration) {
  registration = reg

  // A worker already sitting in "waiting" when we attach (e.g. this tab was
  // opened after the update finished downloading in another tab) also
  // counts as an update ready to apply.
  if (reg.waiting && navigator.serviceWorker.controller) {
    updateAvailable = true
    notify()
  }

  reg.addEventListener('updatefound', () => {
    const installing = reg.installing
    if (!installing) return
    installing.addEventListener('statechange', () => {
      if (installing.state === 'installed' && navigator.serviceWorker.controller) {
        updateAvailable = true
        notify()
      }
    })
  })
}

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return

  const register = () => {
    navigator.serviceWorker
      .register(appPath('/sw.js'), { scope: getBasePath() })
      .then(watchRegistration)
      .catch(() => {
        // The application remains fully usable when service workers are unavailable.
      })
  }
  if ('requestIdleCallback' in window) window.requestIdleCallback(register, { timeout: 2500 })
  else globalThis.setTimeout(register, 1200)

  // A single automatic reload once the new worker takes control -- guarded
  // so a stray extra controllerchange event can never cause a reload loop.
  let hasReloaded = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hasReloaded) return
    hasReloaded = true
    window.location.reload()
  })
}

export function subscribeToPwaUpdate(listener: UpdateListener): () => void {
  listeners.add(listener)
  listener(updateAvailable)
  return () => listeners.delete(listener)
}

export function applyPwaUpdate() {
  registration?.waiting?.postMessage('SKIP_WAITING')
}

export function dismissPwaUpdate() {
  updateAvailable = false
  notify()
}
