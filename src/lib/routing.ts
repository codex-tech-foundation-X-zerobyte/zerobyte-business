/**
 * Centralised URL handling for Vite deployments hosted at `/` or a project
 * sub-path (for example GitHub Pages).
 */
function normaliseBase(value: string) {
  const trimmed = value.trim()
  if (!trimmed || trimmed === '.') return '/'
  const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`
  return withLeadingSlash.endsWith('/') ? withLeadingSlash : `${withLeadingSlash}/`
}

export function getBasePath() {
  return normaliseBase(import.meta.env.BASE_URL || '/')
}

export function appPath(path = '/') {
  const base = getBasePath()
  const cleanPath = path === '/' ? '' : `/${path.replace(/^\/+/, '')}`
  return `${base.slice(0, -1)}${cleanPath || '/'}`
}

export function appRoute(pathname = window.location.pathname) {
  const base = getBasePath()
  if (base === '/') return pathname || '/'
  const baseWithoutTrailingSlash = base.slice(0, -1)
  if (pathname === baseWithoutTrailingSlash || pathname === base) return '/'
  if (!pathname.startsWith(base)) return pathname || '/'
  return pathname.slice(base.length - 1) || '/'
}

export function navigateTo(path: string, replace = false) {
  const url = appPath(path)
  if (replace) window.history.replaceState({}, '', url)
  else window.history.pushState({}, '', url)
  return url
}
