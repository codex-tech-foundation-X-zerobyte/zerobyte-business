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
// If it's unset, this falls back to '*' so local development and first
// deploys keep working -- set it before relying on this in production.
const configuredOrigins = (Deno.env.get('ALLOWED_ORIGINS') ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)

export function corsHeadersFor(request: Request, extra: Record<string, string> = {}) {
  const requestOrigin = request.headers.get('Origin') ?? ''
  const allowOrigin = configuredOrigins.length === 0
    ? '*'
    : configuredOrigins.includes(requestOrigin)
      ? requestOrigin
      : configuredOrigins[0]
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Vary': 'Origin',
    ...extra,
  }
}
