import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabaseUrl = url as string | undefined
export const supabaseAnonKey = anonKey as string | undefined
export const isSupabaseConfigured = Boolean(url && anonKey)

function createSupabaseClient(storageKey?: string) {
  if (!isSupabaseConfigured) return null
  return createClient(url, anonKey, storageKey ? { auth: { storageKey } } : undefined)
}

export const supabase = createSupabaseClient()
// Keep platform administration isolated from the business session on shared devices.
export const adminSupabase = createSupabaseClient('zerobyte-admin-auth')

export function getDataMode() {
  return isSupabaseConfigured ? 'Supabase connected' : 'Supabase configuration required'
}
