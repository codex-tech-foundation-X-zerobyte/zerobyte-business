import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import App from './App'
import { appPath, getBasePath } from './lib/routing'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  const registerWorker = () => {
    navigator.serviceWorker.register(appPath('/sw.js'), { scope: getBasePath() }).catch(() => {
      // The application remains fully usable when service workers are unavailable.
    })
  }
  if ('requestIdleCallback' in window) window.requestIdleCallback(registerWorker, { timeout: 2500 })
  else globalThis.setTimeout(registerWorker, 1200)
}
