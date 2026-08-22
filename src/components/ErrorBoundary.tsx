import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Icon } from './Icon'

interface Props { children: ReactNode; fallback?: (retry: () => void, err: Error) => ReactNode }
interface State { err: Error | null }

/** Catches render-time crashes below any subtree so a broken component does
 *  not blank the whole app. Retry re-mounts the subtree. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { err: null }
  static getDerivedStateFromError(err: Error) { return { err } }
  componentDidCatch(err: Error, info: ErrorInfo) {
    if (import.meta.env.DEV) console.error('[ErrorBoundary]', err, info)
  }
  retry = () => this.setState({ err: null })

  render() {
    if (!this.state.err) return this.props.children
    if (this.props.fallback) return this.props.fallback(this.retry, this.state.err)
    return <DefaultFallback retry={this.retry} err={this.state.err} />
  }
}

function DefaultFallback({ retry, err }: { retry: () => void; err: Error }) {
  return (
    <div style={{
      maxWidth: 420, margin: '48px auto', padding: 24, textAlign: 'center',
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 'var(--r-card)',
    }}>
      <div style={{
        width: 56, height: 56, borderRadius: '50%', background: 'var(--red-light)',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12,
      }}>
        <Icon name="AlertTriangle" size={26} color="var(--red)" />
      </div>
      <h2 style={{ fontSize: 17, fontWeight: 700, color: 'var(--ink)' }}>Something went wrong</h2>
      <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 8, lineHeight: 1.5 }}>
        {err.message || 'An unexpected error occurred.'}
      </p>
      <button type="button" onClick={retry} style={{
        marginTop: 16, height: 'var(--h-primary)', padding: '0 20px',
        borderRadius: 'var(--r-button)', border: 'none',
        background: 'var(--green)', color: '#fff', fontWeight: 600,
        fontSize: 14, cursor: 'pointer',
      }}>
        Try again
      </button>
    </div>
  )
}
