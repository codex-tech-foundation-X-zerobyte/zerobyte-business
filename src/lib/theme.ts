// One place that decides light or dark, so the loading screen, the page background and the app always agree.
// Customer app: the saved choice, otherwise the device setting. Admin console: the saved choice, otherwise dark.
const KEYS = { app: 'zerobyte.theme', admin: 'zerobyte.admin-theme' } as const

export function initialDark(area: keyof typeof KEYS): boolean {
  try {
    const saved = window.localStorage.getItem(KEYS[area])
    if (saved) return saved === 'dark'
    return area === 'admin' ? true : Boolean(window.matchMedia?.('(prefers-color-scheme: dark)').matches)
  } catch {
    return area === 'admin'
  }
}

/** Marks the whole page (loading screens, page background, browser bar) with the theme in use. */
export function applyTheme(dark: boolean) {
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
    meta.setAttribute('content', dark ? '#0a0a0a' : '#f5f6f5')
    meta.removeAttribute('media')
  })
}

export function saveTheme(area: keyof typeof KEYS, dark: boolean) {
  try {
    window.localStorage.setItem(KEYS[area], dark ? 'dark' : 'light')
  } catch {
    /* storage unavailable */
  }
  applyTheme(dark)
}
