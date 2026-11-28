import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { pollWhileVisible } from './visiblePoll'

// The tests run without a browser, so the page's `document` and `window` get tiny stand-ins.
let state: 'visible' | 'hidden' = 'visible'
const listeners = new Set<() => void>()
function setVisibility(next: 'visible' | 'hidden') {
  state = next
  listeners.forEach((listener) => listener())
}

describe('pollWhileVisible', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    state = 'visible'
    listeners.clear()
    vi.stubGlobal('window', { setInterval: (fn: () => void, ms: number) => setInterval(fn, ms), clearInterval: (id: number) => clearInterval(id) })
    vi.stubGlobal('document', {
      get visibilityState() {
        return state
      },
      addEventListener: (_: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
    })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('runs on schedule while visible', () => {
    const run = vi.fn()
    const stop = pollWhileVisible(run, 1000)
    vi.advanceTimersByTime(3000)
    expect(run).toHaveBeenCalledTimes(3)
    stop()
  })
  it('does nothing while the tab is hidden, and catches up once when it returns', () => {
    const run = vi.fn()
    const stop = pollWhileVisible(run, 1000)
    setVisibility('hidden')
    vi.advanceTimersByTime(10000)
    expect(run).not.toHaveBeenCalled()
    setVisibility('visible')
    expect(run).toHaveBeenCalledTimes(1)
    stop()
  })
  it('stops when asked', () => {
    const run = vi.fn()
    pollWhileVisible(run, 1000)()
    vi.advanceTimersByTime(5000)
    expect(run).not.toHaveBeenCalled()
    expect(listeners.size).toBe(0)
  })
})
