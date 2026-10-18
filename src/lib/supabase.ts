import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabaseUrl = url as string | undefined
export const supabaseAnonKey = anonKey as string | undefined
export const isSupabaseConfigured = Boolean(url && anonKey)

// The Supabase client consumes and strips an emailed recovery link's URL hash
// asynchronously, which can happen before React renders. Record the intent
// synchronously, first, so the app can still show the "choose a new password" screen.
export const openedFromRecoveryLink = typeof window !== 'undefined' && /(^|[#&?])type=recovery\b/.test(window.location.hash)
let recoveryEventSeen = false
export const recoveryEventLatched = () => recoveryEventSeen

function createSupabaseClient(storageKey?: string) {
  if (!isSupabaseConfigured) return null
  // Only the business client may pick a session up from the URL; the admin client never should.
  return createClient(url, anonKey, storageKey ? { auth: { storageKey, detectSessionInUrl: false } } : undefined)
}

export const supabase = createSupabaseClient()
// Keep platform administration isolated from the business session on shared devices.
export const adminSupabase = createSupabaseClient('zerobyte-admin-auth')

// Latch the event too (covers the PKCE flow, where the URL has no type=recovery marker).
supabase?.auth.onAuthStateChange((event) => { if (event === 'PASSWORD_RECOVERY') recoveryEventSeen = true })

export function getDataMode() {
  return isSupabaseConfigured ? 'Supabase connected' : 'Supabase configuration required'
}
