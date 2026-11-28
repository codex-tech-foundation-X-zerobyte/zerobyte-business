import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import '../../src/css-app'
// Same pre-render theme step as src/bootstrap.tsx
try {
  const saved = window.localStorage.getItem('zerobyte.theme')
  const dark = saved ? saved === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
} catch { /* ignore */ }
import { Workspace } from '../../src/features/workspace/Workspace'

function Host() {
  const [route, setRoute] = useState(new URLSearchParams(location.search).get('r') || '/app/overview')
  return <Workspace email="owner@mamaput.ng" displayName="Ada Okafor" route={route} navigate={(p) => setRoute(p)} />
}
import { Landing } from '../../src/features/public/Landing'
import '../../src/css-admin'
import { AdminHealthCenter } from '../../src/admin/AdminHealthCenter'
import { GuidePage } from '../../src/features/guide/UserGuide'
const page = new URLSearchParams(location.search).get('p')
const go = (path: string) => console.log('navigate', path)
createRoot(document.getElementById('root')!).render(
  page === 'landing' ? <Landing onStart={() => go('/auth')} navigate={go} /> : page === 'health' ? <div className="admin-shell v2 dark" style={{ display: "block" }}><main className="admin-main"><div className="av-page"><AdminHealthCenter /></div></main></div> : page === 'guide' ? <GuidePage navigate={go} /> : <Host />,
)
