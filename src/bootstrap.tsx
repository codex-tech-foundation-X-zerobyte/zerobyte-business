import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { installActivityFeedback } from './lib/activity'
import { installGlobalErrorHandlers } from './lib/errorReporting'
import { startCodexMonitor } from './lib/codexMonitor'
import { appPath } from './lib/routing'
import { registerServiceWorker } from './lib/pwaUpdate'
import { restoreSpaPath } from './lib/spaRestore'

// If the host showed its "not found" page for a refresh of /app/... or /admin/..., put that address back first.
try {
  restoreSpaPath(window.sessionStorage, window.history, import.meta.env.BASE_URL || '/')
} catch {
  // Storage can be blocked; the visitor then simply starts on the front screen.
}

// Tell the page which theme the user chose before React renders, so the loading screen matches it (no green/dark flash).
try {
  const adminPage = /\/admin(\.html)?(\/|$)/.test(window.location.pathname)
  const saved = window.localStorage.getItem(adminPage ? 'zerobyte.admin-theme' : 'zerobyte.theme')
  const dark = saved ? saved === 'dark' : window.matchMedia?.('(prefers-color-scheme: dark)').matches
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
} catch {
  document.documentElement.dataset.theme = 'light'
}

// Capture a promoter referral code from a link like /?ref=ZB-ABC12 once, at
// the very first page load -- before any client-side navigation can drop
// the query string. Stored under a stable key so WorkspaceSetup can read it
// whenever signup actually happens, however many screens later that is.
// An unrecognized/mistyped code is validated server-side in
// create_workspace and simply ignored there, never blocking signup.
const referralCode = new URLSearchParams(window.location.search).get('ref')
// Only accept a plausible code (letters, digits, dashes, max 20) so arbitrary text is never stored.
const safeReferral = referralCode?.trim().toUpperCase()
if (safeReferral && /^[A-Z0-9-]{3,20}$/.test(safeReferral))
  window.localStorage.setItem('zerobyte.referral_code', safeReferral)

// Paystack sends the customer back to /?payment=return&reference=... . Signed-in visitors are then moved to
// /app/overview, which drops the query string, so the payment reference is saved here first, before anything can
// rewrite the address. usePaymentReturn reads it from this same key (and verifies it with the server).
try {
  const params = new URLSearchParams(window.location.search)
  const reference = params.get('reference') ?? params.get('trxref')
  if (params.get('payment') === 'return' && reference && /^zb_[a-f0-9]{32}$/.test(reference))
    window.sessionStorage.setItem('zb-pending-payment', reference)
} catch {
  /* storage unavailable */
}

installGlobalErrorHandlers()
startCodexMonitor()
installActivityFeedback()

// Supabase reports a bad/expired emailed link as #error_code=... on whatever page it redirects to
// (often the home page, where nothing would display it). Move it to the sign-in page, which does.
const linkError = new URLSearchParams(window.location.hash.replace(/^#/, '')).get('error_code')
if (linkError) {
  window.sessionStorage.setItem('zb-auth-link-error', linkError)
  window.history.replaceState(
    null,
    '',
    appPath(window.location.pathname.endsWith('/promoter-setup') ? '/promoter-setup' : '/auth'),
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)

registerServiceWorker()
