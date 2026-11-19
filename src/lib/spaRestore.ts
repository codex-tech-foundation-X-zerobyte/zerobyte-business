// Counterpart of public/spa-fallback.js. When a host answered a refresh of /app/... or /admin/... with its "not found"
// page, that page saved the address and sent the visitor to the app's front door. This puts the address back before the
// app starts, so the visitor lands on the screen they refreshed instead of on a "page does not exist" page.
const KEY = 'zb-spa-restore'
const SAFE = /^\/(app|admin)(\/[A-Za-z0-9_-]+)*\/?(\?[^#\s]*)?(#[^\s]*)?$/

type StorageLike = Pick<Storage, 'getItem' | 'removeItem'>
type HistoryLike = Pick<History, 'replaceState'>

export function restoreSpaPath(storage: StorageLike, history: HistoryLike, baseUrl = '/') {
  if (baseUrl !== '/') return false // the fallback page only knows root-path deployments
  try {
    const saved = storage.getItem(KEY)
    if (!saved) return false
    storage.removeItem(KEY)
    if (!SAFE.test(saved)) return false
    history.replaceState(null, '', saved)
    return true
  } catch {
    return false
  }
}
