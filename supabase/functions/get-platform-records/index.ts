import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeadersFor } from '../_shared/cors.ts'

const resources = {
  Organizations: { table: 'organizations', columns: 'id,name,slug,created_at' },
  Subscriptions: { table: 'subscriptions', columns: 'id,organization_id,plan_id,status,trial_end,current_period_end,canceled_at,created_at' },
  Branches: { table: 'branches', columns: 'id,organization_id,name,code,status,created_at' },
  Inventory: { table: 'products', columns: 'id,organization_id,name,sku,stock,price,category,created_at' },
  Sales: { table: 'sales', columns: 'id,organization_id,branch_id,total,status,payment_method,created_at' },
  Notifications: { table: 'admin_notifications', columns: 'id,created_by,title,message,audience,status,sent_at,created_at' },
} as const

serve(async (request) => {
  const corsHeaders = corsHeadersFor(request, { 'Access-Control-Allow-Methods': 'GET, OPTIONS' })
  const json = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405)
  const authorization = request.headers.get('Authorization')
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!authorization || !supabaseUrl || !anonKey || !serviceRoleKey) return json({ error: 'Unauthorized' }, 401)

  const caller = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data: userData } = await caller.auth.getUser()
  const user = userData.user
  if (!user) return json({ error: 'Unauthorized' }, 401)
  const { data: allowed, error: accessError } = await caller.rpc('is_platform_admin')
  if (accessError || !allowed) return json({ error: 'Platform administrator access required' }, 403)

  const resource = resources[new URL(request.url).searchParams.get('resource') as keyof typeof resources]
  // Older admin bundles may ask this records endpoint for Monitoring. Keep that
  // request harmless while the dedicated monitoring checks provide the metrics.
  if (new URL(request.url).searchParams.get('resource') === 'Monitoring') {
    return json({ rows: [], resource: 'Monitoring', message: 'Use the monitoring checks for browser-observed diagnostics.' })
  }
  if (!resource) return json({ error: 'Unknown platform resource' }, 400)
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } })
  const { data, error } = await admin.from(resource.table).select(resource.columns).order('created_at', { ascending: false }).limit(100)
  if (error) return json({ error: 'Could not load platform records' }, 500)
  await admin.from('admin_audit_logs').insert({
    actor_id: user.id,
    action: 'platform.records_accessed',
    target_type: resource.table,
    metadata: { resource: resource.table, row_count: data?.length ?? 0 },
  })
  return json({ rows: data ?? [] })
})
