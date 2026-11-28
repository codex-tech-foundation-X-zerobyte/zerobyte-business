// Cloudflare Turnstile (free CAPTCHA) server-side check. Works without any email provider.
//
// Fail CLOSED: if the secret is not configured the check refuses, so forgetting to set it can never silently switch
// the protection off. Set TURNSTILE_DISABLED=true only for local development.
export async function verifyTurnstile(
  token: string | null | undefined,
  remoteIp: string | null,
): Promise<{ ok: boolean; reason?: string }> {
  if (Deno.env.get('TURNSTILE_DISABLED') === 'true') return { ok: true }
  const secret = Deno.env.get('TURNSTILE_SECRET_KEY')
  if (!secret) return { ok: false, reason: 'captcha_not_configured' }
  if (!token || typeof token !== 'string' || token.length > 4096) return { ok: false, reason: 'captcha_missing' }
  try {
    const form = new URLSearchParams({ secret, response: token })
    if (remoteIp && remoteIp !== 'unknown') form.set('remoteip', remoteIp)
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(5000),
    })
    const result = (await response.json()) as { success?: boolean }
    return result.success === true ? { ok: true } : { ok: false, reason: 'captcha_failed' }
  } catch {
    return { ok: false, reason: 'captcha_unreachable' }
  }
}
