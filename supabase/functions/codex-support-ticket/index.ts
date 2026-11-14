// The customer's side of the Codex Customer Service desk, for one support conversation:
//   action "create" (default)  send the chat to Codex as a ticket (safe to repeat: the same chat never makes a second ticket)
//   action "status"            the ticket's status and whether the customer can reply or rate
//   action "reply"             forward a follow-up message from the customer to the ticket
//   action "rate"              rate the help (1 to 5), once, after the ticket is resolved
// The browser sends only the conversation id; the SUPPORT_KEY never leaves this function. The caller must own the
// conversation (checked with the caller's own session, so row-level security applies).
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.118.0'
import { corsHeadersFor } from '../_shared/cors.ts'
import { describeSupportError, supportClient } from '../_shared/codex.ts'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

serve(async (request) => {
  const corsHeaders = corsHeadersFor(request, { 'Access-Control-Allow-Methods': 'POST, OPTIONS' })
  const json = (body: Record<string, unknown>, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const authorization = request.headers.get('Authorization')
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!authorization || !supabaseUrl || !anonKey || !serviceKey) return json({ error: 'Unauthorized' }, 401)
  const caller = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const {
    data: { user },
  } = await caller.auth.getUser()
  if (!user) return json({ error: 'Unauthorized' }, 401)

  let body: { conversationId?: string; action?: string; body?: string; rating?: number; note?: string }
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Request body must be valid JSON' }, 400)
  }
  const conversationId = String(body.conversationId ?? '')
  if (!UUID.test(conversationId)) return json({ error: 'Open a support conversation first.' }, 400)

  // Row-level security limits this to the caller's own conversation.
  const { data: conversation } = await caller
    .from('support_conversations')
    .select('id, organization_id, codex_ticket')
    .eq('id', conversationId)
    .eq('user_id', user.id)
    .maybeSingle()
  if (!conversation) return json({ error: 'Conversation not found.' }, 404)
  const externalRef = `ZB-${conversationId}`

  const client = supportClient()
  if (!client) return json({ error: 'Technical support is not connected yet.' }, 503)
  const admin = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })
  const action = body.action ?? 'create'

  try {
    if (action === 'status') {
      let view: { ticket?: Record<string, unknown> }
      try {
        view = await client.getTicket(externalRef)
      } catch (error) {
        const failure = describeSupportError(error)
        if (failure.status === 404) return json({ exists: false })
        return json({ error: failure.message }, failure.status)
      }
      const ticket = view?.ticket ?? {}
      return json({
        exists: true,
        ticket: {
          ref: conversation.codex_ticket ?? null,
          status: typeof ticket.status === 'string' ? ticket.status : null,
          can_reply: ticket.can_reply === true,
          can_rate: ticket.can_rate === true,
        },
      })
    }

    if (action === 'reply') {
      const text = String(body.body ?? '').trim()
      if (!text || text.length > 4000) return json({ error: 'Write a message of up to 4000 characters.' }, 400)
      await client.reply(externalRef, text)
      return json({ ok: true })
    }

    if (action === 'rate') {
      const rating = Number(body.rating)
      if (!Number.isInteger(rating) || rating < 1 || rating > 5) return json({ error: 'Choose 1 to 5 stars.' }, 400)
      const note = String(body.note ?? '').trim().slice(0, 500)
      await client.rate(externalRef, rating, note || undefined)
      return json({ ok: true })
    }

    // create
    const { data: rows } = await caller
      .from('support_messages')
      .select('body, sender_role, created_at')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })
      .limit(40)
    const customerLines = (rows ?? []).filter((row) => row.sender_role === 'customer').map((row) => String(row.body))
    if (!customerLines.length) return json({ error: 'Write a message first, then send it to technical support.' }, 400)
    const { data: organization } = await caller.from('organizations').select('name').eq('id', conversation.organization_id).maybeSingle()
    const transcript = (rows ?? [])
      .map((row) => `${row.sender_role === 'customer' ? 'Customer' : 'Zerøbyte support'}: ${row.body}`)
      .join('\n')
    const { ticket, duplicate } = await client.createTicket({
      external_ref: externalRef,
      customer_ref: user.id,
      customer_name: String(user.user_metadata?.full_name ?? '').slice(0, 120) || undefined,
      subject: customerLines[0].replace(/\s+/g, ' ').trim().slice(0, 200).padEnd(3, '.'),
      description: `Business: ${organization?.name ?? 'unknown'}\n\n${transcript}`.slice(0, 8000),
      category: 'other',
      priority: 'normal',
    })
    if (ticket) await admin.from('support_conversations').update({ codex_ticket: ticket }).eq('id', conversationId)
    return json({ ticket: ticket ?? null, duplicate })
  } catch (error) {
    const failure = describeSupportError(error)
    return json({ error: failure.message }, failure.status)
  }
})
