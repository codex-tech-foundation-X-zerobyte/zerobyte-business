import { siteConfig } from './siteConfig'
import { getConsent, onConsentChange } from './consent'

// Google Analytics 4, loaded ONLY after the visitor accepts analytics cookies and only if VITE_GA_MEASUREMENT_ID is set.
// Consent Mode starts as "denied", so nothing is stored before a choice is made. Rejecting later switches it back off.

type Gtag = (...args: unknown[]) => void
declare global {
  interface Window {
    dataLayer?: unknown[]
    gtag?: Gtag
    [key: `ga-disable-${string}`]: boolean | undefined
  }
}

let loaded = false

function ensureGtag() {
  window.dataLayer = window.dataLayer || []
  if (!window.gtag)
    window.gtag = function gtag() {
      // gtag.js requires the real `arguments` object, not a rest-parameter array.
      // eslint-disable-next-line prefer-rest-params
      window.dataLayer!.push(arguments)
    }
  return window.gtag
}

function load() {
  const id = siteConfig.gaMeasurementId
  if (!id || loaded) return
  const gtag = ensureGtag()
  gtag('consent', 'default', {
    analytics_storage: 'denied',
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
  })
  const script = document.createElement('script')
  script.async = true
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`
  document.head.appendChild(script)
  gtag('js', new Date())
  gtag('config', id, { send_page_view: false, anonymize_ip: true })
  loaded = true
}

function apply(analytics: boolean) {
  const id = siteConfig.gaMeasurementId
  if (!id) return
  window[`ga-disable-${id}`] = !analytics
  if (analytics) {
    load()
    ensureGtag()('consent', 'update', { analytics_storage: 'granted' })
  } else if (loaded) {
    ensureGtag()('consent', 'update', { analytics_storage: 'denied' })
    // remove the cookies Google set so a rejection actually clears them
    for (const name of document.cookie
      .split(';')
      .map((part) => part.split('=')[0].trim())
      .filter((name) => name === '_ga' || name.startsWith('_ga_'))) {
      document.cookie = `${name}=; Max-Age=0; path=/`
      document.cookie = `${name}=; Max-Age=0; path=/; domain=.${window.location.hostname.replace(/^www\./, '')}`
    }
  }
}

// Screens that carry private links (a promoter's set-up link holds a secret) are never reported.
const NOT_TRACKED = ['/promoter-setup', '/promoter-dashboard']

/** The address Google sees: the page only, never the query string or hash (those can hold tokens or personal details). */
const cleanLocation = () => `${window.location.origin}${window.location.pathname}`

const ready = () => Boolean(siteConfig.gaMeasurementId) && loaded && getConsent()?.analytics === true

export function trackPageView(path: string) {
  if (!ready() || NOT_TRACKED.includes(path)) return
  ensureGtag()('event', 'page_view', { page_path: path, page_title: document.title, page_location: cleanLocation() })
}

type AnalyticsEvent = 'sign_up' | 'generate_lead' | 'begin_checkout' | 'purchase'

/** Records one of the few business events worth measuring (mark them as "key events" in Google Analytics). Nothing personal is sent. */
export function trackEvent(name: AnalyticsEvent, params: Record<string, string | number> = {}) {
  if (!ready()) return
  ensureGtag()('event', name, params)
}

export function startGoogleAnalytics() {
  apply(getConsent()?.analytics === true)
  onConsentChange((consent) => {
    apply(consent.analytics)
    // The page the visitor is already looking at when they accept cookies still counts.
    if (consent.analytics) trackPageView(window.location.pathname)
  })
}
