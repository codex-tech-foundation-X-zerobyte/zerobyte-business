import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import App from './App'
<<<<<<< HEAD
import { registerServiceWorker } from './lib/pwaUpdate'
=======
import { appPath, getBasePath } from './lib/routing'
>>>>>>> b04b3351326f61cfeb195000ac3fbc1689a33cd7

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

<<<<<<< HEAD
registerServiceWorker()
=======
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  const registerWorker = () => {
    navigator.serviceWorker.register(appPath('/sw.js'), { scope: getBasePath() }).catch(() => {
      // The application remains fully usable when service workers are unavailable.
    })
  }
  if ('requestIdleCallback' in window) window.requestIdleCallback(registerWorker, { timeout: 2500 })
  else globalThis.setTimeout(registerWorker, 1200)
}
>>>>>>> b04b3351326f61cfeb195000ac3fbc1689a33cd7
