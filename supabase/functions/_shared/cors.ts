// Shared CORS handling for every platform Edge Function.
//
// Each function used to hardcode 'Access-Control-Allow-Origin: *', and
// create-sale had no CORS handling at all. A wildcard doesn't bypass this
// project's auth (every function still verifies the caller's JWT and, where
// relevant, platform-admin access before doing anything), but it does let
// any website's JavaScript send authenticated requests here if it ever gets
// hold of a valid token, and it's needless extra surface area.
//
// Allowed origins are an exact-match allowlist: the production frontend
// (below) plus anything listed in the ALLOWED_ORIGINS function secret, e.g.
//   supabase secrets set ALLOWED_ORIGINS="https://app.example.com"
// Secrets are read when a function starts, so redeploy after changing it.
// localhost is trusted only while ALLOWED_ORIGINS is unset (local dev).
// Any other origin gets no Access-Control-Allow-Origin header -- it fails
// closed, never falling back to '*'.
// The production frontend is part of the explicit allowlist in code, so a
// missing or mistyped ALLOWED_ORIGINS secret cannot lock the real app out of
// its own admin functions. ALLOWED_ORIGINS adds further origins (a custom
// domain, a staging site); it never replaces this one. This is an exact-match
// list -- never a wildcard, never a pattern like *.vercel.app.
const PRODUCTION_ORIGINS = [
  // Vercel production alias.
  'https://zerobyte-business.vercel.app',
  // GitHub Pages deployment (browsers send the origin lowercased).
  'https://codex-tech-foundation-x-zerobyte.github.io',
]

const configuredOrigins = (Deno.env.get('ALLOWED_ORIGINS') ?? '')
  .split(',')
  .map((origin) => origin.trim().replace(/\/$/, ''))
  .filter(Boolean)

const allowedOrigins = new Set([...PRODUCTION_ORIGINS, ...configuredOrigins])

const DEV_ORIGIN_PATTERN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i

function isAllowedOrigin(origin: string): boolean {
  if (!origin) return false
  if (allowedOrigins.has(origin)) return true
  // localhost is only trusted while no extra origins are configured, i.e. in
  // local development. Once ALLOWED_ORIGINS is set, a dev origin must be
  // listed explicitly like any other.
  if (configuredOrigins.length === 0 && DEV_ORIGIN_PATTERN.test(origin)) return true
  return false
}

// Methods the platform functions actually use: GET for the read endpoints,
// POST for the write ones, OPTIONS for preflight. Nothing else is offered.
export function corsHeadersFor(request: Request, extra: Record<string, string> = {}) {
  const requestOrigin = request.headers.get('Origin') ?? ''
  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Max-Age': '600',
    'Vary': 'Origin',
    ...extra,
  }
  // Fail closed: no Access-Control-Allow-Origin at all for an origin that
  // isn't explicitly allowed. CORS is not authorization -- every function
  // still verifies the caller's JWT and platform-admin role itself.
  if (isAllowedOrigin(requestOrigin)) {
    headers['Access-Control-Allow-Origin'] = requestOrigin
  }
  return headers
}
