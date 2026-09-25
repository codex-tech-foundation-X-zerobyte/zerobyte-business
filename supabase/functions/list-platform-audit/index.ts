import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeadersFor } from '../_shared/cors.ts'

serve(async (request) => {
  const corsHeaders = corsHeadersFor(request)
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: corsHeaders })
  const authorization = request.headers.get('Authorization')
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!authorization || !supabaseUrl || !anonKey || !serviceRoleKey) return new Response('Server configuration is incomplete', { status: 500, headers: corsHeaders })

  const caller = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } } })
  const { data: { user }, error: authError } = await caller.auth.getUser()
  if (authError || !user) return new Response('Unauthorized', { status: 401, headers: corsHeaders })
  const admin = createClient(supabaseUrl, serviceRoleKey)
  const { data: access, error: accessError } = await admin.from('platform_admin_access').select('role').eq('user_id', user.id).eq('status', 'active').limit(1).maybeSingle()
  if (accessError) return new Response(accessError.message, { status: 500, headers: corsHeaders })
  if (!access) return new Response('Platform administrator access required', { status: 403, headers: corsHeaders })

  const limit = Math.min(Math.max(Number(new URL(request.url).searchParams.get('limit') ?? '100') || 100, 1), 200)
  const [{ data: platformLogs, error: platformError }, { data: projectLogs, error: projectError }] = await Promise.all([
    admin.from('admin_audit_logs').select('id,actor_id,actor_role,action,target_type,target_id,organization_id,metadata,created_at').order('created_at', { ascending: false }).limit(limit),
    admin.from('audit_logs').select('id,actor_id,action,entity_type,entity_id,organization_id,metadata,created_at').order('created_at', { ascending: false }).limit(limit),
  ])
  if (platformError || projectError) return new Response(platformError?.message ?? projectError?.message ?? 'Could not load audit logs', { status: 500, headers: corsHeaders })

  const repository = Deno.env.get('GITHUB_REPOSITORY') ?? 'codextech-lab/zerobyte-business'
  const githubToken = Deno.env.get('GITHUB_TOKEN')
  let githubStatus: 'healthy' | 'failed' = 'healthy'
  let githubDetail = githubToken
    ? 'GitHub API connected with a token; higher rate limits apply.'
    : 'Connected without a token; public rate limits apply.'
  let githubRateLimitRemaining: number | null = null
  let githubEvents: unknown[] = []
  const githubResponse = await fetch(`https://api.github.com/repos/${repository}/events?per_page=${Math.min(limit, 100)}`, {
    headers: { Accept: 'application/vnd.github+json', ...(githubToken ? { Authorization: `Bearer ${githubToken}` } : {}) },
  })
  const remainingHeader = githubResponse.headers.get('x-ratelimit-remaining')
  if (remainingHeader !== null) githubRateLimitRemaining = Number(remainingHeader)
  if (githubResponse.ok) {
    githubEvents = await githubResponse.json().catch(() => [])
  } else {
    githubStatus = 'failed'
    githubDetail = githubResponse.status === 403 && githubRateLimitRemaining === 0
      ? 'GitHub API rate limit exceeded for this token/IP.'
      : `GitHub API request failed with HTTP ${githubResponse.status}.`
  }
  const entries = [
    ...(platformLogs ?? []).map((row) => ({ source: 'Supabase platform', id: row.id, action: row.action, actor: row.actor_id, target: row.target_type ? `${row.target_type}${row.target_id ? ` · ${row.target_id}` : ''}` : 'Platform', organizationId: row.organization_id, metadata: row.metadata, createdAt: row.created_at })),
    ...(projectLogs ?? []).map((row) => ({ source: 'Supabase project', id: row.id, action: row.action, actor: row.actor_id, target: `${row.entity_type}${row.entity_id ? ` · ${row.entity_id}` : ''}`, organizationId: row.organization_id, metadata: row.metadata, createdAt: row.created_at })),
    ...(Array.isArray(githubEvents) ? githubEvents.map((event: { id: string; type: string; actor?: { login?: string }; repo?: { name?: string }; created_at: string; payload?: { action?: string } }) => ({ source: 'GitHub', id: event.id, action: event.payload?.action ? `${event.type} · ${event.payload.action}` : event.type, actor: event.actor?.login ?? 'GitHub actor', target: event.repo?.name ?? repository, organizationId: null, metadata: {}, createdAt: event.created_at })) : []),
  ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, limit)

  return new Response(JSON.stringify({
    repository,
    githubConfigured: Boolean(githubToken),
    entries,
    // Nested object the admin monitoring page's GitHub check reads. This
    // used to be missing entirely -- the check only ever saw
    // `payload.github` as undefined, so it always reported "not configured"
    // regardless of whether GITHUB_REPOSITORY/GITHUB_TOKEN were actually
    // set. `configured` here means "the repository lookup itself
    // succeeded", not "a token is present" -- a public repo is genuinely
    // reachable without one.
    github: {
      configured: githubResponse.ok,
      status: githubStatus,
      detail: githubDetail,
      hasToken: Boolean(githubToken),
      rateLimitRemaining: githubRateLimitRemaining,
    },
  }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
})
