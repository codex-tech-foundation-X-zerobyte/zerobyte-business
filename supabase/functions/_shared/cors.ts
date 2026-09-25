// Shared CORS handling for every platform Edge Function.
//
// Each function used to hardcode 'Access-Control-Allow-Origin: *', and
// create-sale had no CORS handling at all. A wildcard doesn't bypass this
// project's auth (every function still verifies the caller's JWT and, where
// relevant, platform-admin access before doing anything), but it does let
// any website's JavaScript send authenticated requests here if it ever gets
// hold of a valid token, and it's needless extra surface area.
//
// Configure the ALLOWED_ORIGINS function secret with a comma-separated list
// of the site's own origin(s), e.g.:
//   supabase secrets set ALLOWED_ORIGINS="https://your-app.example.com,https://your-app.github.io"
//
// This now FAILS CLOSED when ALLOWED_ORIGINS is missing or invalid, rather
// than falling back to '*'. The only origins ever allowed without explicit
// configuration are localhost/127.0.0.1 (any port) and Vite's default
// network preview host, so local development keeps working. Everything else
// -- including a misconfigured or unset production secret -- gets no
// Access-Control-Allow-Origin header at all, which browsers treat as a
// same-origin-only response and block for cross-origin JS callers.
const configuredOrigins = (Deno.env.get('ALLOWED_ORIGINS') ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)

const DEV_ORIGIN_PATTERN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i

function isAllowedOrigin(origin: string): boolean {
  if (!origin) return false
  if (configuredOrigins.includes(origin)) return true
  // Only ever trusted when no production allow-list has been configured --
  // once ALLOWED_ORIGINS is set, dev origins must be listed explicitly too.
  if (configuredOrigins.length === 0 && DEV_ORIGIN_PATTERN.test(origin)) return true
  return false
}

export function corsHeadersFor(request: Request, extra: Record<string, string> = {}) {
  const requestOrigin = request.headers.get('Origin') ?? ''
  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Vary': 'Origin',
    ...extra,
  }
  // Fail closed: omit the header entirely for any origin that isn't
  // explicitly allowed, instead of echoing '*' or an unrelated origin.
  if (isAllowedOrigin(requestOrigin)) {
    headers['Access-Control-Allow-Origin'] = requestOrigin
  }
  return headers
}
