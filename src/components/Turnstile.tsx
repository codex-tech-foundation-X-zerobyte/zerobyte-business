import { useCallback, useEffect, useRef, useState } from 'react'

// Cloudflare Turnstile: a free, privacy-friendly human check. It needs no email and no per-message cost.
// Set VITE_TURNSTILE_SITE_KEY to switch it on; without a key the hook renders nothing (local development).
export const turnstileSiteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined

type TurnstileApi = {
  render: (element: HTMLElement, options: Record<string, unknown>) => string
  reset: (widgetId?: string) => void
  remove: (widgetId?: string) => void
}
declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

let scriptPromise: Promise<void> | null = null
function loadTurnstile(): Promise<void> {
  if (window.turnstile) return Promise.resolve()
  scriptPromise ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => {
      scriptPromise = null
      reject(new Error('Turnstile failed to load'))
    }
    document.head.appendChild(script)
  })
  return scriptPromise
}

export function useTurnstile() {
  const enabled = Boolean(turnstileSiteKey)
  const [token, setToken] = useState<string | null>(null)
  const [host, setHost] = useState<HTMLDivElement | null>(null)
  const widgetId = useRef<string | null>(null)

  useEffect(() => {
    if (!enabled || !host) return
    let cancelled = false
    void loadTurnstile()
      .then(() => {
        if (cancelled || !window.turnstile || widgetId.current) return
        widgetId.current = window.turnstile.render(host, {
          sitekey: turnstileSiteKey,
          theme: 'auto',
          callback: (value: string) => setToken(value),
          'expired-callback': () => setToken(null),
          'error-callback': () => setToken(null),
        })
      })
      .catch(() => setToken(null))
    return () => {
      cancelled = true
      if (widgetId.current) window.turnstile?.remove(widgetId.current)
      widgetId.current = null
    }
  }, [enabled, host])

  // A solved token works once. Call this after every attempt so the person gets a fresh check for the next one.
  const reset = useCallback(() => {
    setToken(null)
    if (widgetId.current) window.turnstile?.reset(widgetId.current)
  }, [])

  const element = enabled ? <div ref={setHost} className="turnstile-box" /> : null
  return { enabled, token, reset, element }
}
