import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.118.0'
import { recordLatency, startTimer } from '../_shared/latency.ts'
import { type Alert, type Deps, isAllowed, runCommand } from './commands.ts'

// Telegram calls this function whenever someone messages the bot. Three locks protect it:
//   1. Telegram must send our secret in X-Telegram-Bot-Api-Secret-Token (set when the webhook is registered).
//   2. Only the chat ids listed in TELEGRAM_CHAT_ID are answered; every other chat is ignored silently.
//   3. Every command is read-only, and errors are never shown in chat.
// It always answers 200 so Telegram does not retry; deploy with --no-verify-jwt (Telegram cannot send a login token).

const timingSafeEqual = (a: string, b: string) => {
  const x = new TextEncoder().encode(a)
  const y = new TextEncoder().encode(b)
  if (x.length !== y.length) return false
  let diff = 0
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i]
  return diff === 0
}

serve(async (request) => {
  const timer = startTimer()
  const done = (status: number, body = 'ok') => {
    void recordLatency('telegram-bot', timer, status)
    return new Response(body, { status })
  }
  if (request.method !== 'POST') return done(405, 'Method not allowed')

  const secret = Deno.env.get('TELEGRAM_WEBHOOK_SECRET') ?? ''
  const sent = request.headers.get('x-telegram-bot-api-secret-token') ?? ''
  if (!secret || !timingSafeEqual(secret, sent)) return done(401, 'Unauthorized')

  const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN')
  const url = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!botToken || !url || !serviceKey) return done(200)

  let update: { message?: { text?: string; chat?: { id?: number; type?: string } } }
  try {
    update = await request.json()
  } catch {
    return done(200)
  }
  const chatId = update.message?.chat?.id
  if (!isAllowed(chatId, Deno.env.get('TELEGRAM_CHAT_ID'))) return done(200) // strangers get no reply at all

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } })
  const deps: Deps = {
    snapshot: async (force) => {
      const { data, error } = await admin.rpc('platform_health_snapshot_get', { p_max_age: '5 minutes', p_force: force })
      if (error) throw error
      return data
    },
    alerts: async (snapshot) => {
      const { data, error } = await admin.rpc('platform_health_alerts', { s: snapshot })
      if (error) throw error
      return (data ?? []) as Alert[]
    },
    stats: async () => {
      const { data, error } = await admin.rpc('platform_bot_stats')
      if (error) throw error
      return data
    },
    findBusiness: async (query) => {
      const { data, error } = await admin.rpc('platform_bot_find_business', { p_query: query })
      if (error) throw error
      return data ?? []
    },
    ping: async () => {
      const t0 = performance.now()
      const { error } = await admin.from('plans').select('id').limit(1)
      const dbMs = error ? null : Math.round(performance.now() - t0)
      const t1 = performance.now()
      let authOk = false
      try {
        const res = await fetch(`${url}/auth/v1/health`, { headers: { apikey: Deno.env.get('SUPABASE_ANON_KEY') ?? serviceKey } })
        authOk = res.ok
      } catch {
        authOk = false
      }
      return { dbMs, authOk, authMs: authOk ? Math.round(performance.now() - t1) : null }
    },
  }

  const reply = await runCommand(update.message?.text, deps)
  if (reply) {
    try {
      await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: reply, disable_web_page_preview: true }),
      })
    } catch {
      // Nothing to do; the next command will try again.
    }
  }
  return done(200)
})
