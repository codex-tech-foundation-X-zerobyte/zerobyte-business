import { adminSupabase, supabaseAnonKey, supabaseUrl } from '../lib/supabase'

export const ADMIN_REQUEST_TIMEOUT_MS = 5000
// Data requests (user lists, promoter access, ...) hit edge functions that can take several seconds on a cold start.
// The 5s constant above stays as the health-check latency budget used by the monitoring page.
export const ADMIN_DATA_TIMEOUT_MS = 20000

export function adminAuthHeaders(token: string, anonKey: string) {
  return { apikey: anonKey, Authorization: `Bearer ${token}` }
}

export async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit = {}, timeoutMs = ADMIN_REQUEST_TIMEOUT_MS) {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } finally {
    window.clearTimeout(timeout)
  }
}

export async function getAdminAccessToken() {
  if (!adminSupabase) return null
  let current
  try {
    current = await adminSupabase.auth.getSession()
  } catch {
    return null
  }
  let session = current.data.session
  if (current.error || !session) return null
  if (session.expires_at && session.expires_at * 1000 <= Date.now() + 30_000) {
    const refreshed = await adminSupabase.auth.refreshSession().catch(() => ({ data: { session: null }, error: new Error('Session refresh failed') }))
    if (refreshed.error || !refreshed.data.session) return null
    session = refreshed.data.session
  }
  return session.access_token
}

// Calls an admin Edge Function with a fresh access token, transparently
// refreshing and retrying once on a 401 before giving up and signing the
// admin out (their session is genuinely no longer valid at that point).
export async function fetchAdminFunction(path: string, init: RequestInit = {}, timeoutMs = ADMIN_DATA_TIMEOUT_MS) {
  if (!adminSupabase || !supabaseUrl || !supabaseAnonKey) return { response: null, expired: false, error: 'Admin service is not configured.' }
  const anonKey = supabaseAnonKey
  const request = async (token: string) => fetchWithTimeout(`${supabaseUrl}/functions/v1/${path}`, {
    ...init,
    headers: { ...(init.headers ?? {}), ...adminAuthHeaders(token, anonKey) },
  }, timeoutMs)
  const token = await getAdminAccessToken()
  if (!token) return { response: null, expired: true }
  let response: Response
  try {
    response = await request(token)
  } catch (reason) {
    return { response: null, expired: false, timedOut: reason instanceof DOMException && reason.name === 'AbortError', error: reason instanceof Error ? reason.message : 'Admin request failed.' }
  }
  if (response.status !== 401) return { response, expired: false }
  const refreshed = await adminSupabase.auth.refreshSession().catch(() => ({ data: { session: null }, error: new Error('Session refresh failed') }))
  if (refreshed.error || !refreshed.data.session) {
    await adminSupabase.auth.signOut()
    return { response, expired: true }
  }
  try {
    response = await request(refreshed.data.session.access_token)
  } catch (reason) {
    return { response: null, expired: false, timedOut: reason instanceof DOMException && reason.name === 'AbortError', error: reason instanceof Error ? reason.message : 'Admin request failed.' }
  }
  if (response.status === 401) {
    await adminSupabase.auth.signOut()
    return { response, expired: true }
  }
  return { response, expired: false }
}

export async function withTimeout<T>(promise: PromiseLike<T>, timeoutMs = ADMIN_REQUEST_TIMEOUT_MS) {
  let timeout: number | undefined
  try {
    return await Promise.race([
      Promise.resolve(promise),
      new Promise<T>((_, reject) => { timeout = window.setTimeout(() => reject(new Error('Request timed out')), timeoutMs) }),
    ])
  } finally {
    if (timeout) window.clearTimeout(timeout)
  }
}
