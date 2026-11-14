import { setRobots } from './lib/pageMeta'
import { Suspense, lazy, useCallback, useEffect, useState } from 'react'
import { WorkspaceSkeleton } from './components/ui'
import {
  AdminAccessDenied,
  AdminConsoleUnavailable,
  AdminLogin,
  AuthScreen,
  ConfigurationRequired,
  ConfirmAccessScreen,
  PromoterLinkProblem,
  ResetPasswordScreen,
} from './features/auth/AuthScreens'
import { PromoterApplicationPage } from './features/promoter/PromoterPages'
import { AdminMfaStep } from './features/auth/AdminMfa'
import { Landing } from './features/public/Landing'
import { LegalPage } from './features/public/LegalPage'
import { SupportPage } from './features/public/SupportPage'
import { CookieConsent } from './components/CookieConsent'
import { startGoogleAnalytics, trackPageView } from './lib/googleAnalytics'
import { GuidePage } from './features/guide/UserGuide'
import { trackVisit } from './lib/analytics'
import { UpdateBanner } from './features/pwa/PwaStatus'
import { appPath, appRoute, navigateTo } from './lib/routing'
import {
  adminSupabase,
  isSupabaseConfigured,
  openedFromRecoveryLink,
  recoveryEventLatched,
  supabase,
} from './lib/supabase'

// Code-split: the admin console (monitoring, audit log, user management,
// support inbox) is mutually exclusive with the business workspace at
// runtime, yet both used to ship in the same bundle regardless of which one
// a visitor actually loaded -- so every business-app visit paid to download
// and parse admin-only code it would never run, and vice versa. Lazy-loading
// it means index.html and admin.html each only fetch what they use.
const AdminConsole = lazy(() => import('./AdminConsole'))
// The signed-in app is large and public visitors never need it, so it loads only when someone signs in.
const Workspace = lazy(() => import('./features/workspace/Workspace').then((module) => ({ default: module.Workspace })))
const PromoterDashboard = lazy(() =>
  import('./features/promoter/PromoterDashboard').then((module) => ({ default: module.PromoterDashboard })),
)

function App() {
  const [sessionReady, setSessionReady] = useState(false)
  const [signedIn, setSignedIn] = useState(false)
  const [email, setEmail] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [adminAuthorized, setAdminAuthorized] = useState(false)
  const [adminChecked, setAdminChecked] = useState(false)
  const [adminMfa, setAdminMfa] = useState<'none' | 'verify' | 'enroll'>('none')

  // Decides what an admin-console visitor sees: the console, an authenticator-code prompt, first-time two-factor
  // setup, or "access denied". The server is the authority (is_platform_admin also demands the second factor once
  // two-factor is switched on); this only chooses which screen to show.
  const checkAdminAccess = useCallback(async () => {
    if (!adminSupabase) return
    const [{ data: allowed }, { data: identity }, { data: aal }] = await Promise.all([
      adminSupabase.rpc('is_platform_admin'),
      adminSupabase.rpc('admin_identity_check'),
      adminSupabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    ])
    const needsCode = Boolean(identity) && aal?.nextLevel === 'aal2' && aal?.currentLevel !== 'aal2'
    if (needsCode) {
      setAdminMfa('verify')
      setAdminAuthorized(false)
    } else if (!allowed && identity) {
      setAdminMfa('enroll') // an admin whose session is refused only because two-factor is required and not set up yet
      setAdminAuthorized(false)
    } else {
      setAdminMfa('none')
      setAdminAuthorized(Boolean(allowed))
    }
    setAdminChecked(true)
  }, [])
  const isAdminPath = (pathname: string) => {
    const route = appRoute(pathname)
    return route === '/admin' || route === '/admin.html'
  }
  const adminEntry = document.documentElement.dataset.zerobyteApp === 'admin' || isAdminPath(window.location.pathname)
  const [path, setPath] = useState(adminEntry ? '/admin' : appRoute())
  // Opening the emailed reset link lands here with type=recovery in the URL hash; capture it before the Supabase client cleans the URL.
  const [accessToken] = useState(() => {
    if (adminEntry) return null
    const query = new URLSearchParams(window.location.search)
    const hash = query.get('token_hash')
    return hash && query.get('type') === 'recovery' ? hash : null
  })
  const [tokenPending, setTokenPending] = useState(() => Boolean(accessToken))
  const [recovering, setRecovering] = useState(() => !adminEntry && (openedFromRecoveryLink || recoveryEventLatched()))

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
    if (!authClient) {
      setSessionReady(true)
      return
    }
    authClient.auth.getSession().then(({ data }) => {
      const hasSession = Boolean(data.session)
      setSignedIn(hasSession)
      setEmail(data.session?.user.email ?? '')
      setDisplayName(data.session?.user.user_metadata?.full_name ?? data.session?.user.user_metadata?.name ?? '')
      if (hasSession && appRoute() === '/auth') {
        navigate('/')
      }
      if (hasSession && adminEntry) void checkAdminAccess()
      setSessionReady(true)
    })
    if (!adminEntry && recoveryEventLatched()) setRecovering(true)
    const { data } = authClient.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' && !adminEntry) setRecovering(true)
      const hasSession = Boolean(session)
      setSignedIn(hasSession)
      setEmail(session?.user.email ?? '')
      setDisplayName(session?.user.user_metadata?.full_name ?? session?.user.user_metadata?.name ?? '')
      if (hasSession) {
        if (appRoute() === '/auth') {
          navigate('/')
        }
        if (adminEntry) void checkAdminAccess()
      } else {
        setAdminAuthorized(false)
        setAdminChecked(false)
        setAdminMfa('none')
      }
    })
    return () => data.subscription.unsubscribe()
  }, [adminEntry, checkAdminAccess])

  const isPromoterSetup = path === '/promoter-setup'
  useEffect(() => {
    if (sessionReady && !adminEntry) trackVisit(path)
  }, [path, sessionReady, adminEntry])
  const publicPage = [
    '/',
    '/auth',
    '/promoters',
    '/guide',
    '/privacy',
    '/terms',
    '/cookies',
    '/about',
    '/support',
    '/promoter-setup',
  ].includes(path)
  useEffect(() => {
    if (!adminEntry) startGoogleAnalytics()
  }, [adminEntry])
  // Only the public pages may be listed by search engines. The sign-in page, promoter set-up and dashboard, and the
  // signed-in workspace (which shares the home address) are marked noindex.
  const indexable =
    ['/', '/promoters', '/guide', '/support', '/privacy', '/terms', '/cookies', '/about'].includes(path) &&
    !(path === '/' && signedIn)
  useEffect(() => {
    if (!adminEntry) setRobots(indexable ? 'index' : 'noindex')
  }, [adminEntry, indexable])
  useEffect(() => {
    if (sessionReady && !adminEntry && publicPage) trackPageView(path)
  }, [path, sessionReady, adminEntry, publicPage])
  // The cookie choice is asked on public pages (never inside the signed-in app or the admin console).
  const showCookieChoice =
    sessionReady &&
    !adminEntry &&
    publicPage &&
    (!signedIn || ['/guide', '/privacy', '/terms', '/cookies', '/about', '/support', '/promoters'].includes(path))
  const content = (() => {
    if (!sessionReady) return <WorkspaceSkeleton />
    if (path === '/terms' || path === '/privacy' || path === '/cookies' || path === '/about')
      return <LegalPage type={path.slice(1) as 'terms' | 'privacy' | 'cookies' | 'about'} navigate={navigate} />
    if (path === '/guide') return <GuidePage navigate={navigate} />
    if (path === '/support') return <SupportPage navigate={navigate} />
    if (path === '/promoters') return <PromoterApplicationPage navigate={navigate} />
    if (!isSupabaseConfigured) return <ConfigurationRequired />
    if (path === '/admin') {
      if (!isSupabaseConfigured) return <AdminConsoleUnavailable />
      if (!signedIn) return <AdminLogin />
      // Wait for the server-side role check instead of flashing "Access denied" at legitimate admins on every load.
      if (!adminChecked) return <WorkspaceSkeleton />
      if (!adminAuthorized && adminMfa !== 'none')
        return (
          <AdminMfaStep
            mode={adminMfa}
            email={email}
            onDone={() => void checkAdminAccess()}
            onSignOut={() => void adminSupabase?.auth.signOut()}
          />
        )
      if (!adminAuthorized) return <AdminAccessDenied email={email} onBack={() => navigate('/')} />
      return (
        <Suspense fallback={<WorkspaceSkeleton />}>
          <AdminConsole
            email={email}
            onBack={() => navigate('/')}
            onLogout={() => {
              void adminSupabase?.auth.signOut()
              navigate('/')
            }}
          />
        </Suspense>
      )
    }
    if (accessToken && tokenPending)
      return (
        <ConfirmAccessScreen
          audience={isPromoterSetup ? 'promoter' : undefined}
          tokenHash={accessToken}
          onVerified={() => {
            setSignedIn(true)
            setTokenPending(false)
            setRecovering(true)
            window.history.replaceState(null, '', appPath(isPromoterSetup ? '/promoter-setup' : '/auth'))
          }}
        />
      )
    if (recovering && signedIn)
      return (
        <ResetPasswordScreen
          audience={isPromoterSetup ? 'promoter' : undefined}
          onComplete={() => {
            setRecovering(false)
            if (isPromoterSetup) {
              window.history.replaceState(null, '', appPath('/promoter-dashboard'))
              setPath('/promoter-dashboard')
              return
            }
            window.history.replaceState(null, '', appPath('/'))
            navigate('/')
          }}
        />
      )
    // A promoter's setup link that is expired, already used, or opened without its token must not fall through to the owner sign-in form.
    if (isPromoterSetup)
      return signedIn ? (
        <PromoterDashboard navigate={navigate} />
      ) : recovering || openedFromRecoveryLink ? (
        <WorkspaceSkeleton />
      ) : (
        <PromoterLinkProblem
          onSignIn={() => {
            window.sessionStorage.setItem('zb-auth-tab', 'promoter')
            navigate('/auth')
          }}
        />
      )
    if (!signedIn && path !== '/auth') return <Landing onStart={() => navigate('/auth')} navigate={navigate} />
    if (path === '/auth') return <AuthScreen />
    if (path === '/promoter-dashboard') return <PromoterDashboard navigate={navigate} />
    return <Workspace email={email} displayName={displayName} />
  })()

  return (
    <>
      <Suspense fallback={<WorkspaceSkeleton />}>{content}</Suspense>
      <CookieConsent visible={showCookieChoice} />
      <UpdateBanner />
    </>
  )
}

export default App
