// A random token that identifies this browser install, kept so that one person cannot farm free trials by making
// account after account in the same browser. It is sent once, when a business is created, and only ever stored
// as a one-way hash on the server. It is a signal, not a secret: clearing browser data resets it, which is why the
// server also checks email spelling, address bursts and shared domains.
const KEY = 'zerobyte.device'
let memoryFallback: string | null = null

function randomToken(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function getDeviceId(): string {
  try {
    const existing = window.localStorage.getItem(KEY)
    if (existing && existing.length >= 16) return existing
    const created = randomToken()
    window.localStorage.setItem(KEY, created)
    return created
  } catch {
    // Storage blocked (private mode): stay stable for this page load.
    memoryFallback ??= randomToken()
    return memoryFallback
  }
}
