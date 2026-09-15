import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

type AuditEntry = {
  source: string
  id: string
  action: string
  actor: string | null
  target: string
  organizationId: string | null
  metadata: Record<string, unknown>
  createdAt: string
}

function githubHeaders(token: string | undefined) {
  return {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
}

async function githubJson(url: string, token: string | undefined) {
  const response = await fetch(url, { headers: githubHeaders(token) })
  const body = await response.json().catch(() => null)
  return { response, body }
}

function actor(value: { login?: string } | null | undefined) {
  return value?.login ?? 'GitHub'
}

function githubEntries(repository: string, payloads: Record<string, unknown[]>): AuditEntry[] {
  const entries: AuditEntry[] = []
  for (const event of payloads.events ?? []) {
    const item = event as { id?: string; type?: string; actor?: { login?: string }; repo?: { name?: string }; created_at?: string; payload?: { action?: string; ref?: string; workflow_run?: { id?: number; name?: string; conclusion?: string; html_url?: string }; deployment?: { id?: number; environment?: string; created_at?: string }; pull_request?: { number?: number; title?: string; html_url?: string; merged?: boolean } } }
    if (!item.id || !item.created_at) continue
    const action = item.payload?.action ? `${item.type ?? 'GitHub event'} · ${item.payload.action}` : item.type ?? 'GitHub event'
    entries.push({ source: 'GitHub', id: item.id, action, actor: actor(item.actor), target: item.repo?.name ?? repository, organizationId: null, metadata: { ref: item.payload?.ref, workflow: item.payload?.workflow_run, deployment: item.payload?.deployment, pull_request: item.payload?.pull_request }, createdAt: item.created_at })
  }
  for (const run of payloads.runs ?? []) {
    const item = run as { id?: number; name?: string; event?: string; status?: string; conclusion?: string | null; actor?: { login?: string }; head_branch?: string; html_url?: string; updated_at?: string; created_at?: string }
    const createdAt = item.updated_at ?? item.created_at
    if (!item.id || !createdAt) continue
    const result = item.conclusion ?? item.status ?? 'unknown'
    entries.push({ source: 'GitHub Actions', id: `workflow-${item.id}`, action: `Workflow run · ${result}`, actor: actor(item.actor), target: item.name ?? 'GitHub Actions', organizationId: null, metadata: { status: item.status, conclusion: item.conclusion, event: item.event, branch: item.head_branch, url: item.html_url }, createdAt })
  }
  for (const pull of payloads.pulls ?? []) {
    const item = pull as { id?: number; number?: number; title?: string; state?: string; merged_at?: string | null; updated_at?: string; user?: { login?: string }; html_url?: string }
    if (!item.id || !item.updated_at) continue
    entries.push({ source: 'GitHub', id: `pull-${item.id}`, action: `Pull request · ${item.state ?? 'updated'}${item.merged_at ? ' · merged' : ''}`, actor: actor(item.user), target: `Pull request #${item.number ?? item.id}`, organizationId: null, metadata: { title: item.title, state: item.state, merged_at: item.merged_at, url: item.html_url }, createdAt: item.updated_at })
  }
  for (const deployment of payloads.deployments ?? []) {
    const item = deployment as { id?: number; environment?: string; description?: string | null; created_at?: string; updated_at?: string; creator?: { login?: string }; sha?: string; url?: string }
    if (!item.id || !item.created_at) continue
    entries.push({ source: 'GitHub Deployments', id: `deployment-${item.id}`, action: 'Deployment created', actor: actor(item.creator), target: item.environment ?? 'GitHub deployment', organizationId: null, metadata: { description: item.description, sha: item.sha, url: item.url }, createdAt: item.created_at })
  }
  return entries
}

serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: corsHeaders })
  const authorization = request.headers.get('Authorization')
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!authorization || !supabaseUrl || !anonKey || !serviceRoleKey) return new Response(JSON.stringify({ message: 'Server configuration is incomplete' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  const caller = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } } })
  const { data: { user }, error: authError } = await caller.auth.getUser()
  if (authError || !user) return new Response(JSON.stringify({ message: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  const admin = createClient(supabaseUrl, serviceRoleKey)
  const { data: access, error: accessError } = await admin.from('platform_admin_access').select('role').eq('user_id', user.id).eq('status', 'active').limit(1).maybeSingle()
  if (accessError) return new Response(JSON.stringify({ message: accessError.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  if (!access) return new Response(JSON.stringify({ message: 'Platform administrator access required' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  const limit = Math.min(Math.max(Number(new URL(request.url).searchParams.get('limit') ?? '100') || 100, 1), 200)
  const [{ data: platformLogs, error: platformError }, { data: projectLogs, error: projectError }] = await Promise.all([
    admin.from('admin_audit_logs').select('id,actor_id,actor_role,action,target_type,target_id,organization_id,metadata,created_at').order('created_at', { ascending: false }).limit(limit),
    admin.from('audit_logs').select('id,actor_id,action,entity_type,entity_id,organization_id,metadata,created_at').order('created_at', { ascending: false }).limit(limit),
  ])
  if (platformError || projectError) return new Response(JSON.stringify({ message: platformError?.message ?? projectError?.message ?? 'Could not load audit logs' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  const repository = Deno.env.get('GITHUB_REPOSITORY')?.trim() ?? ''
  const githubToken = Deno.env.get('GITHUB_TOKEN')
  const github = { configured: Boolean(repository), status: 'configuration' as 'healthy' | 'failed' | 'configuration', detail: repository ? 'Checking GitHub API' : 'GITHUB_REPOSITORY is not configured', repository: repository || null }
  const payloads: Record<string, unknown[]> = { events: [], runs: [], pulls: [], deployments: [] }
  if (repository && !/^[^/\s]+\/[^/\s]+$/.test(repository)) {
    github.status = 'failed'
    github.detail = 'GITHUB_REPOSITORY must use the owner/repository format'
  } else if (repository) {
    const base = `https://api.github.com/repos/${repository}`
    const results = await Promise.all([
      githubJson(`${base}/events?per_page=${Math.min(limit, 100)}`, githubToken),
      githubJson(`${base}/actions/runs?per_page=${Math.min(limit, 100)}`, githubToken),
      githubJson(`${base}/pulls?state=all&sort=updated&direction=desc&per_page=${Math.min(limit, 100)}`, githubToken),
      githubJson(`${base}/deployments?per_page=${Math.min(limit, 100)}`, githubToken),
    ])
    const failed = results.find(({ response }) => !response.ok)
    if (failed) {
      github.status = 'failed'
      github.detail = `GitHub API returned HTTP ${failed.response.status}`
    } else {
      github.status = 'healthy'
      github.detail = `GitHub API connected${githubToken ? ' with server token' : ' without a token (public rate limits apply)'}`
      payloads.events = Array.isArray(results[0].body) ? results[0].body : []
      payloads.runs = Array.isArray((results[1].body as { workflow_runs?: unknown[] } | null)?.workflow_runs) ? ((results[1].body as { workflow_runs: unknown[] }).workflow_runs) : []
      payloads.pulls = Array.isArray(results[2].body) ? results[2].body : []
      payloads.deployments = Array.isArray(results[3].body) ? results[3].body : []
    }
  }
  const entries: AuditEntry[] = [
    ...(platformLogs ?? []).map((row) => ({ source: 'Supabase platform', id: row.id, action: row.action, actor: row.actor_id, target: row.target_type ? `${row.target_type}${row.target_id ? ` · ${row.target_id}` : ''}` : 'Platform', organizationId: row.organization_id, metadata: row.metadata, createdAt: row.created_at })),
    ...(projectLogs ?? []).map((row) => ({ source: 'Supabase project', id: row.id, action: row.action, actor: row.actor_id, target: `${row.entity_type}${row.entity_id ? ` · ${row.entity_id}` : ''}`, organizationId: row.organization_id, metadata: row.metadata, createdAt: row.created_at })),
    ...githubEntries(repository, payloads),
  ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, limit)
  if (github.status !== 'healthy') {
    entries.unshift({
      source: 'GitHub',
      id: 'github-integration-status',
      action: `GitHub integration · ${github.status}`,
      actor: 'System',
      target: github.repository ?? 'Repository',
      organizationId: null,
      metadata: { detail: github.detail },
      createdAt: new Date().toISOString(),
    })
  }

  return new Response(JSON.stringify({ repository: repository || null, githubConfigured: github.configured, github, entries }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
})
