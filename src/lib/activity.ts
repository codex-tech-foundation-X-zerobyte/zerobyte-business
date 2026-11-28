// App-wide "something is happening" feedback, so nobody has to wonder whether a click worked.
//
//  * A thin progress bar runs along the top while the app is talking to the server.
//  * The button you pressed turns into a spinner and ignores further clicks until the server answers. That stops
//    double-submits (two sales, two payments) without every screen needing its own "busy" flag.
//
// It works by watching fetch: a request that starts within BIND_WINDOW_MS of a button press is "that button's
// request". Background traffic (realtime, polling) never blocks a button because it does not follow a press.
const BIND_WINDOW_MS = 700
const BAR_DELAY_MS = 120
// A request that never answers must not leave a button dead forever.
const MAX_BUSY_MS = 20_000

let installed = false

export function installActivityFeedback() {
  if (installed || typeof window === 'undefined') return
  installed = true

  const bar = document.createElement('div')
  bar.className = 'zb-progress'
  bar.setAttribute('role', 'progressbar')
  bar.setAttribute('aria-hidden', 'true')
  document.body.appendChild(bar)

  let inflight = 0
  let showTimer: number | undefined
  let hideTimer: number | undefined
  const syncBar = () => {
    const active = inflight > 0
    window.clearTimeout(showTimer)
    window.clearTimeout(hideTimer)
    if (active)
      showTimer = window.setTimeout(() => bar.classList.add('on'), bar.classList.contains('on') ? 0 : BAR_DELAY_MS)
    else hideTimer = window.setTimeout(() => bar.classList.remove('on'), 200)
  }

  let pressed: { el: HTMLButtonElement; at: number } | null = null
  const busyCounts = new WeakMap<HTMLButtonElement, number>()
  const markBusy = (el: HTMLButtonElement, on: boolean) => {
    if (on) {
      el.dataset.busy = 'true'
      el.setAttribute('aria-busy', 'true')
    } else {
      delete el.dataset.busy
      el.removeAttribute('aria-busy')
    }
  }

  const buttonFrom = (target: EventTarget | null) => (target instanceof Element ? target.closest('button') : null)

  // Capture phase: runs before React's handlers, so a busy button's repeat clicks never reach them.
  document.addEventListener(
    'click',
    (event) => {
      const button = buttonFrom(event.target)
      if (!button) return
      if (button.dataset.busy === 'true') {
        event.stopImmediatePropagation()
        event.preventDefault()
        return
      }
      if (button.disabled || button.hasAttribute('data-no-busy')) return
      pressed = { el: button, at: Date.now() }
    },
    true,
  )

  const nativeFetch = window.fetch.bind(window)
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const background =
      /\/realtime\/|\/rest\/v1\/.*[?&]select=.*&limit=1$|platform-health-ping|\.(png|jpe?g|svg|webp|woff2?)(\?|$)/.test(
        url,
      )
    const owner =
      !background && pressed && Date.now() - pressed.at < BIND_WINDOW_MS && pressed.el.isConnected ? pressed.el : null
    if (!background) {
      inflight += 1
      syncBar()
    }
    if (owner) {
      busyCounts.set(owner, (busyCounts.get(owner) ?? 0) + 1)
      markBusy(owner, true)
    }
    let finished = false
    const done = () => {
      if (finished) return
      finished = true
      if (!background) {
        inflight = Math.max(0, inflight - 1)
        syncBar()
      }
      if (!owner) return
      const left = (busyCounts.get(owner) ?? 1) - 1
      busyCounts.set(owner, left)
      if (left <= 0) markBusy(owner, false)
    }
    const watchdog = owner ? window.setTimeout(done, MAX_BUSY_MS) : undefined
    return nativeFetch(input, init).finally(() => {
      window.clearTimeout(watchdog)
      done()
    })
  }
}
