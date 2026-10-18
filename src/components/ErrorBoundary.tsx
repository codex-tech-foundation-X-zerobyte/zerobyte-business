import { Component, type ErrorInfo, type ReactNode } from 'react'
import { reportClientError } from '../lib/errorReporting'

type Props = { children: ReactNode }
type State = { failed: boolean }

// Without a boundary, one render exception unmounts the whole React tree and
// the user is left with a blank page. This shows a recovery screen instead.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    reportClientError(error, { source: 'ErrorBoundary', componentStack: info.componentStack?.slice(0, 600) })
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <main className="error-boundary" role="alert">
        <div className="error-boundary-card">
          <div className="error-boundary-mark" aria-hidden="true">ø</div>
          <h1>Something went wrong</h1>
          <p>The page hit an unexpected problem. Your saved records are safe. Reloading usually fixes it.</p>
          <div className="error-boundary-actions">
            <button type="button" className="primary" onClick={() => window.location.reload()}>Reload page</button>
            <button type="button" className="secondary" onClick={() => { window.location.href = window.location.origin + (import.meta.env.BASE_URL ?? '/') }}>Go to start</button>
          </div>
        </div>
      </main>
    )
  }
}
