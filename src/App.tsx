import { Suspense, lazy, useEffect, useState } from 'react'
import { WorkspaceSkeleton } from './components/ui'
import { AdminAccessDenied, AdminConsoleUnavailable, AdminLogin, AuthScreen, ConfigurationRequired } from './features/auth/AuthScreens'
import { PromoterApplicationPage, PromoterDashboard } from './features/promoter/PromoterPages'
import { Landing, LegalPage } from './features/public/PublicPages'
import { UpdateBanner } from './features/pwa/PwaStatus'
import { Workspace } from './features/workspace/Workspace'
import { appRoute, navigateTo } from './lib/routing'
import { adminSupabase, isSupabaseConfigured, supabase } from './lib/supabase'

// Code-split: the admin console (monitoring, audit log, user management,
// support inbox) is mutually exclusive with the business workspace at
// runtime, yet both used to ship in the same bundle regardless of which one
// a visitor actually loaded -- so every business-app visit paid to download
// and parse admin-only code it would never run, and vice versa. Lazy-loading
// it means index.html and admin.html each only fetch what they use.
const AdminConsole = lazy(() => import('./AdminConsole'))

function App() {
  const [sessionReady, setSessionReady] = useState(false); const [signedIn, setSignedIn] = useState(false); const [email, setEmail] = useState(''); const [displayName, setDisplayName] = useState('')
  const [adminAuthorized, setAdminAuthorized] = useState(false)
  const isAdminPath = (pathname: string) => {
    const route = appRoute(pathname)
    return route === '/admin' || route === '/admin.html'
  }
  const adminEntry = document.documentElement.dataset.zerobyteApp === 'admin' || isAdminPath(window.location.pathname)
  const [path, setPath] = useState(adminEntry ? '/admin' : appRoute())

  const navigate = (nextPath: string) => {
    navigateTo(nextPath)
    setPath(nextPath)
  }

  useEffect(() => {
    const onPopState = () => setPath(isAdminPath(window.location.pathname) ? '/admin' : appRoute())
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  useEffect(() => {
    const authClient = adminEntry ? adminSupabase : supabase
    if (!authClient) { setSessionReady(true); return }
    authClient.auth.getSession().then(({ data }) => {
      const hasSession = Boolean(data.session)
      setSignedIn(hasSession); setEmail(data.session?.user.email ?? ''); setDisplayName(data.session?.user.user_metadata?.full_name ?? data.session?.user.user_metadata?.name ?? '')
      if (hasSession && appRoute() === '/auth') {
        navigate('/')
      }
      if (hasSession && adminEntry) void adminSupabase?.rpc('is_platform_admin').then(({ data: allowed }) => setAdminAuthorized(Boolean(allowed)))
      setSessionReady(true)
    })
    const { data } = authClient.auth.onAuthStateChange((_event, session) => {
      const hasSession = Boolean(session)
      setSignedIn(hasSession); setEmail(session?.user.email ?? ''); setDisplayName(session?.user.user_metadata?.full_name ?? session?.user.user_metadata?.name ?? '')
      if (hasSession) {
        if (appRoute() === '/auth') {
          navigate('/')
        }
        if (adminEntry) void adminSupabase?.rpc('is_platform_admin').then(({ data: allowed }) => setAdminAuthorized(Boolean(allowed)))
      }
    })
    return () => data.subscription.unsubscribe()
  }, [adminEntry])

  const content = (() => {
    if (!sessionReady) return <WorkspaceSkeleton />
    if (path === '/terms' || path === '/privacy' || path === '/cookies') return <LegalPage type={path.slice(1) as 'terms' | 'privacy' | 'cookies'} navigate={navigate} />
    if (path === '/promoters') return <PromoterApplicationPage navigate={navigate} />
    if (!isSupabaseConfigured) return <ConfigurationRequired />
    if (path === '/admin') {
      if (!isSupabaseConfigured) return <AdminConsoleUnavailable />
      if (!signedIn) return <AdminLogin />
      if (!adminAuthorized) return <AdminAccessDenied email={email} onBack={() => navigate('/')} />
      return <Suspense fallback={<WorkspaceSkeleton />}><AdminConsole email={email} onBack={() => navigate('/')} onLogout={() => { void adminSupabase?.auth.signOut(); window.localStorage.removeItem('zerobyte.admin-access'); navigate('/') }} /></Suspense>
    }
    if (!signedIn && path !== '/auth') return <Landing onStart={() => navigate('/auth')} />
    if (path === '/auth') return <AuthScreen />
    if (path === '/promoter-dashboard') return <PromoterDashboard navigate={navigate} />
    return <Workspace email={email} displayName={displayName} />
  })()

  return <>{content}<UpdateBanner /></>
}

export default App
