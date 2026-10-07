import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { installGlobalErrorHandlers } from './lib/errorReporting'
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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)

registerServiceWorker()
