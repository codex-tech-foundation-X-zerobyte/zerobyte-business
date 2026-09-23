import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeadersFor } from '../_shared/cors.ts'

serve(async (request) => {
  // This function previously had no CORS handling at all. A POST with a
  // JSON body and an Authorization header is a non-simple request, so
  // browsers preflight it with an OPTIONS request first -- with nothing
  // here to answer that preflight, cross-origin calls from the app (the
  // normal case, since the app and the Supabase project are on different
  // origins) would have been rejected by the browser before this code ever
  // ran.
  const corsHeaders = corsHeadersFor(request, { 'Access-Control-Allow-Methods': 'POST, OPTIONS' })
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders })
  const authorization = request.headers.get('Authorization')
  if (!authorization) return new Response('Missing authorization', { status: 401, headers: corsHeaders })
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authorization } },
  })
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return new Response('Unauthorized', { status: 401, headers: corsHeaders })
  const { organizationId, customerId, items, operationId, branchId, paymentMethod } = await request.json()
  if (!organizationId || !Array.isArray(items) || items.length === 0) {
    return new Response('organizationId and items are required', { status: 400, headers: corsHeaders })
  }
  const rpcName = operationId ? 'create_sale_with_operation' : 'create_sale'
  const { data, error } = await supabase.rpc(rpcName, operationId ? {
    target_org: organizationId,
    target_customer: customerId ?? null,
    items,
    target_branch: branchId ?? null,
    target_payment_method: paymentMethod ?? 'cash',
    operation_id: operationId,
  } : {
    target_org: organizationId,
    target_customer: customerId ?? null,
    items,
    target_branch: branchId ?? null,
    target_payment_method: paymentMethod ?? 'cash',
  })
  if (error) return new Response(error.message, { status: 400, headers: corsHeaders })
  return new Response(JSON.stringify({ saleId: data }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
})
