// A small "show the last answer now, fetch the fresh one in the background" cache that lives only on this device.
//
// What it is for: screens that read a lot and change little (the product list, reports). The last good answer is kept in
// memory and in localStorage, so reopening a screen shows something at once instead of a spinner, and the fresh answer
// replaces it a moment later.
//
// What it is NOT for: anything that must be exact at the moment of use (stock inside a sale, subscription state,
// payments). Those always come from the server. The server stays the source of truth: every screen that shows a saved
// copy still asks for fresh data straight away and replaces the copy.
//
// Privacy: copies are removed when the person signs out (clearDataCache) and are never shared between businesses
// because every key carries the business id.

const PREFIX = 'zb.swr:'
const MAX_AGE_MS = 1000 * 60 * 60 * 24 * 7 // a saved copy older than a week is ignored
const MAX_BYTES = 250_000 // a single copy larger than this is not stored on the device

type Entry<T> = { at: number; value: T }
const memory = new Map<string, Entry<unknown>>()

function storage() {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

export function readStale<T>(key: string, maxAgeMs = MAX_AGE_MS): T | null {
  const now = Date.now()
  const inMemory = memory.get(key) as Entry<T> | undefined
  if (inMemory && now - inMemory.at <= maxAgeMs) return inMemory.value
  try {
    const raw = storage()?.getItem(PREFIX + key)
    if (!raw) return null
    const entry = JSON.parse(raw) as Entry<T>
    if (typeof entry?.at !== 'number' || now - entry.at > maxAgeMs) return null
    memory.set(key, entry)
    return entry.value
  } catch {
    return null
  }
}

export function writeCache<T>(key: string, value: T) {
  const entry: Entry<T> = { at: Date.now(), value }
  memory.set(key, entry)
  try {
    const raw = JSON.stringify(entry)
    if (raw.length > MAX_BYTES) return
    storage()?.setItem(PREFIX + key, raw)
  } catch {
    // Storage full or blocked: the memory copy still works and the network is the source of truth.
  }
}

// Forget saved copies whose key starts with this text (for example after a change that makes them wrong).
export function invalidateCache(startsWith: string) {
  for (const key of [...memory.keys()]) if (key.startsWith(startsWith)) memory.delete(key)
  try {
    const store = storage()
    if (!store) return
    for (const key of Object.keys(store)) if (key.startsWith(PREFIX + startsWith)) store.removeItem(key)
  } catch {
    // Nothing to do: the copies expire on their own.
  }
}

// Called at sign-out so the next person on a shared device never sees the last business's numbers.
export function clearDataCache() {
  memory.clear()
  try {
    const store = storage()
    if (!store) return
    for (const key of Object.keys(store)) if (key.startsWith(PREFIX)) store.removeItem(key)
  } catch {
    // Nothing to do.
  }
}
