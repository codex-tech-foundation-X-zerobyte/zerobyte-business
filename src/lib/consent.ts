import { useEffect, useState } from 'react'

// Cookie and storage consent. Essential storage (sign-in session, your settings) never needs consent. Analytics is OFF
// until the visitor explicitly accepts it, and "Reject" is exactly as easy as "Accept".

const KEY = 'zerobyte.consent.v1'
const EVENT = 'zb:consent-changed'
export const OPEN_SETTINGS_EVENT = 'zb:open-cookie-settings'

export type Consent = { analytics: boolean; decidedAt: string }

export function getConsent(): Consent | null {
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return null
    const value = JSON.parse(raw) as Partial<Consent>
    return typeof value.analytics === 'boolean' && typeof value.decidedAt === 'string'
      ? { analytics: value.analytics, decidedAt: value.decidedAt }
      : null
  } catch {
    return null
  }
}

export function setConsent(analytics: boolean) {
  const value: Consent = { analytics, decidedAt: new Date().toISOString() }
  try {
    window.localStorage.setItem(KEY, JSON.stringify(value))
  } catch {
    /* storage unavailable: the choice lasts for this page view only */
  }
  window.dispatchEvent(new CustomEvent<Consent>(EVENT, { detail: value }))
}

export function onConsentChange(listener: (consent: Consent) => void) {
  const handler = (event: Event) => listener((event as CustomEvent<Consent>).detail)
  window.addEventListener(EVENT, handler)
  return () => window.removeEventListener(EVENT, handler)
}

export function useConsent() {
  const [consent, setValue] = useState<Consent | null>(() => getConsent())
  useEffect(() => onConsentChange(setValue), [])
  return consent
}

export const openCookieSettings = () => window.dispatchEvent(new Event(OPEN_SETTINGS_EVENT))
