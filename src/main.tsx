import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import App from './App'
import { registerServiceWorker } from './lib/pwaUpdate'

// Capture a promoter referral code from a link like /?ref=ZB-ABC12 once, at
// the very first page load -- before any client-side navigation can drop
// the query string. Stored under a stable key so WorkspaceSetup can read it
// whenever signup actually happens, however many screens later that is.
// An unrecognized/mistyped code is validated server-side in
// create_workspace and simply ignored there, never blocking signup.
const referralCode = new URLSearchParams(window.location.search).get('ref')
if (referralCode) window.localStorage.setItem('zerobyte.referral_code', referralCode.trim().toUpperCase())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

registerServiceWorker()
