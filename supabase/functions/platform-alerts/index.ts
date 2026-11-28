import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.118.0'
import { recordLatency, startTimer } from '../_shared/latency.ts'

// Run every 15 minutes by a scheduler (see docs/ADMIN-HEALTH.md). It asks the database which health alerts are new
// (or still unresolved after the cooldown) and pushes them to Telegram and/or a webhook (Slack, Discord, Make, Zapier).
// Callers must send the shared secret in the x-cron-secret header; there is no browser access to this function.
type Alert = { key: string; severity: 'critical' | 'warning' | 'info'; title: string; detail: string }

const timingSafeEqual = (a: string, b: string) => {
  const x = new TextEncoder().encode(a)
  const y = new TextEncoder().encode(b)
  if (x.length !== y.length) return false
  let diff = 0
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i]
  return diff === 0
}

const icon = (severity: string) => (severity === 'critical' ? '🔴' : severity === 'warning' ? '🟠' : '🔵')

serve(async (request) => {
  const timer = startTimer()
  const reply = (body: Record<string, unknown>, status = 200) => {
    void recordLatency('platform-alerts', timer, status)
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  }
  if (request.method !== 'POST') return reply({ error: 'Method not allowed' }, 405)

  const secret = Deno.env.get('ALERT_CRON_SECRET') ?? ''
  const sent = request.headers.get('x-cron-secret') ?? ''
  if (!secret || !timingSafeEqual(secret, sent)) return reply({ error: 'Unauthorized' }, 401)

  const url = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !serviceKey) return reply({ error: 'Server configuration is incomplete' }, 500)
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } })

  const { data, error } = await admin.rpc('platform_claim_alerts', { p_cooldown_hours: 6 })
  if (error || !data) return reply({ error: 'Could not read alerts' }, 500)
  const fire = (data.fire ?? []) as Alert[]
  const resolved = (data.resolved ?? []) as string[]
  if (fire.length === 0 && resolved.length === 0) return reply({ sent: 0, resolved: 0 })

  const brand = Deno.env.get('ALERT_BRAND') ?? 'Zerøbyte'
  const lines = [
    ...fire.map((a) => `${icon(a.severity)} ${a.title}\n${a.detail}`),
    ...(resolved.length ? [`✅ Back to normal: ${resolved.join(', ')}`] : []),
  ]
  const text = `${brand} health\n\n${lines.join('\n\n')}`

  const results: Record<string, string> = {}
  const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN')
  const chatId = Deno.env.get('TELEGRAM_CHAT_ID')
  if (botToken && chatId) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
      })
      results.telegram = res.ok ? 'sent' : `failed ${res.status}`
    } catch {
      results.telegram = 'failed'
    }
  }
  const hook = Deno.env.get('ALERT_WEBHOOK_URL')
  if (hook) {
    try {
      // `text` for Slack and Discord-style hooks; the structured fields for Make, Zapier or your own receiver.
      const res = await fetch(hook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, content: text, alerts: fire, resolved }),
      })
      results.webhook = res.ok ? 'sent' : `failed ${res.status}`
    } catch {
      results.webhook = 'failed'
    }
  }
  if (!botToken && !hook) results.note = 'No TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID or ALERT_WEBHOOK_URL is set'
  return reply({ sent: fire.length, resolved: resolved.length, channels: results })
})
