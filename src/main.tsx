import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/plus-jakarta-sans'
import '@fontsource-variable/bricolage-grotesque'
import './styles.css'
import './design.css'
import './polish.css'
import './theme.css'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { installActivityFeedback } from './lib/activity'
import { installGlobalErrorHandlers } from './lib/errorReporting'
import { appPath } from './lib/routing'
import { registerServiceWorker } from './lib/pwaUpdate'

// Capture a promoter referral code from a link like /?ref=ZB-ABC12 once, at
// the very first page load -- before any client-side navigation can drop
// the query string. Stored under a stable key so WorkspaceSetup can read it
// whenever signup actually happens, however many screens later that is.
// An unrecognized/mistyped code is validated server-side in
// create_workspace and simply ignored there, never blocking signup.
const referralCode = new URLSearchParams(window.location.search).get('ref')
// Only accept a plausible code (letters, digits, dashes, max 20) so arbitrary text is never stored.
const safeReferral = referralCode?.trim().toUpperCase()
if (safeReferral && /^[A-Z0-9-]{3,20}$/.test(safeReferral)) window.localStorage.setItem('zerobyte.referral_code', safeReferral)

installGlobalErrorHandlers()
installActivityFeedback()

// Supabase reports a bad/expired emailed link as #error_code=... on whatever page it redirects to
// (often the home page, where nothing would display it). Move it to the sign-in page, which does.
const linkError = new URLSearchParams(window.location.hash.replace(/^#/, '')).get('error_code')
if (linkError) {
  window.sessionStorage.setItem('zb-auth-link-error', linkError)
  window.history.replaceState(null, '', appPath('/auth'))
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)

registerServiceWorker()
