import { getConsent, onConsentChange } from './consent'
import { supabase } from './supabase'

// Privacy-friendly visit counting. No cookies, no IP address, no user agent is stored. We send a random id kept on this
// device; the database stores only a hash of (id + today's date), so one person looks like a new visitor each day.
// Browsers that send "Do Not Track" are not counted at all, and neither is anyone who chose "Reject" in the cookie banner
// (their anonymous id is deleted).

const VISITOR_KEY = 'zerobyte.vid'
const PUBLIC_PATHS = new Set([
  '/',
  '/auth',
  '/promoters',
  '/guide',
  '/privacy',
  '/terms',
  '/cookies',
  '/support',
  '/promoter-setup',
])

function visitorId() {
  try {
    let id = window.localStorage.getItem(VISITOR_KEY)
    if (!id || !/^[A-Za-z0-9_-]{16,64}$/.test(id)) {
      id = (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, '').slice(0, 40)
      window.localStorage.setItem(VISITOR_KEY, id)
    }
    return id
  } catch {
    return null
  }
}
const doNotTrack = () =>
  navigator.doNotTrack === '1' || (window as unknown as { doNotTrack?: string }).doNotTrack === '1'
function device() {
  const ua = navigator.userAgent
  if (/iPad|Tablet|PlayBook|Silk/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua))) return 'tablet'
  if (/Mobi|iPhone|Android/i.test(ua)) return 'mobile'
  return 'desktop'
}
const seen = (key: string) => {
  try {
    if (window.sessionStorage.getItem(key)) return true
    window.sessionStorage.setItem(key, '1')
  } catch {
    /* private mode */
  }
  return false
}

// Counts one visit to a public page per tab session.
export function trackVisit(path: string) {
  // Counting stops if the visitor rejected analytics (an undecided visitor is counted: no cookies, no IP address).
  const consent = getConsent()
  if (
    !supabase ||
    doNotTrack() ||
    (consent && !consent.analytics) ||
    !PUBLIC_PATHS.has(path) ||
    seen(`zerobyte.tracked.${path}`)
  )
    return
  const id = visitorId()
  if (!id) return
  let referrer: string | null = null
  try {
    if (document.referrer && new URL(document.referrer).host !== window.location.host) referrer = document.referrer
  } catch {
    /* ignore */
  }
  const ref = window.localStorage.getItem('zerobyte.referral_code')
  void Promise.resolve(
    supabase.rpc('track_visit', { p_visitor: id, p_path: path, p_referrer: referrer, p_ref: ref, p_device: device() }),
  ).catch(() => undefined)
}

// Marks this signed-in account as active today (one tiny row per account per day).
export function recordActivity(orgId: string | null) {
  if (!supabase || seen('zerobyte.activity')) return
  void Promise.resolve(supabase.rpc('record_activity', { p_org: orgId })).catch(() => undefined)
}

// Rejecting analytics removes the anonymous visitor id from this device straight away.
onConsentChange((consent) => {
  if (!consent.analytics) {
    try {
      window.localStorage.removeItem(VISITOR_KEY)
    } catch {
      /* ignore */
    }
  }
})
if (getConsent()?.analytics === false) {
  try {
    window.localStorage.removeItem(VISITOR_KEY)
  } catch {
    /* ignore */
  }
}
