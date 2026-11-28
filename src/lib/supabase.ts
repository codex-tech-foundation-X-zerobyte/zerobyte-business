import { createClient } from '@supabase/supabase-js'
import { regionalFetch } from './functionRegion'
import { withSafeErrors } from './safeErrors'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabaseUrl = url as string | undefined
export const supabaseAnonKey = anonKey as string | undefined
export const isSupabaseConfigured = Boolean(url && anonKey)

// The Supabase client consumes and strips an emailed recovery link's URL hash
// asynchronously, which can happen before React renders. Record the intent
// synchronously, first, so the app can still show the "choose a new password" screen.
export const openedFromRecoveryLink =
  typeof window !== 'undefined' && /(^|[#&?])type=recovery\b/.test(window.location.hash)
let recoveryEventSeen = false
export const recoveryEventLatched = () => recoveryEventSeen

// The browser's saved sign-in used a name that spells out the data service and project ('sb-<project>-auth-token').
// It now uses a neutral name. Move an existing sign-in across once so nobody is signed out by this change.
const BUSINESS_SESSION_KEY = 'zerobyte-auth'
function moveLegacySession() {
  try {
    if (!url || typeof window === 'undefined') return
    const legacy = `sb-${new URL(url).hostname.split('.')[0]}-auth-token`
    const store = window.localStorage
    for (const suffix of ['', '-user', '-code-verifier']) {
      const value = store.getItem(legacy + suffix)
      if (value === null) continue
      if (store.getItem(BUSINESS_SESSION_KEY + suffix) === null) store.setItem(BUSINESS_SESSION_KEY + suffix, value)
      store.removeItem(legacy + suffix)
    }
  } catch {
    // Storage can be blocked; the person simply signs in again.
  }
}
moveLegacySession()

function createSupabaseClient(storageKey: string, detectSessionInUrl: boolean) {
  if (!isSupabaseConfigured) return null
  return createClient(url, anonKey, {
    auth: { storageKey, detectSessionInUrl },
    global: {
      // Runs Edge Functions in the database's region when VITE_FUNCTIONS_REGION is set (see functionRegion.ts), and
      // keeps technical wording out of every error the app can show (see safeErrors.ts).
      fetch: withSafeErrors(regionalFetch),
      // Replaces the library's default label, which names the library and its version on every request.
      headers: { 'X-Client-Info': 'zerobyte-web' },
    },
  })
}

// Only the business client may pick a session up from the URL; the admin client never should.
export const supabase = createSupabaseClient(BUSINESS_SESSION_KEY, true)
// Keep platform administration isolated from the business session on shared devices.
export const adminSupabase = createSupabaseClient('zerobyte-admin-auth', false)

// Latch the event too (covers the PKCE flow, where the URL has no type=recovery marker).
supabase?.auth.onAuthStateChange((event) => {
  if (event === 'PASSWORD_RECOVERY') recoveryEventSeen = true
})
