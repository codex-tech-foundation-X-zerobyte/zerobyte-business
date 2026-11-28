// Runs `run` every `everyMs` milliseconds, but only while the tab is visible. A tab left open in the background (or a
// phone with the screen off) stops asking the database anything. When the person comes back and more than `everyMs`
// has passed, it runs once straight away. Returns a function that stops it.
export function pollWhileVisible(run: () => void, everyMs: number): () => void {
  let last = Date.now()
  const tick = () => {
    if (document.visibilityState !== 'visible') return
    last = Date.now()
    run()
  }
  const timer = window.setInterval(tick, everyMs)
  const onVisible = () => {
    if (document.visibilityState === 'visible' && Date.now() - last >= everyMs) tick()
  }
  document.addEventListener('visibilitychange', onVisible)
  return () => {
    window.clearInterval(timer)
    document.removeEventListener('visibilitychange', onVisible)
  }
}
