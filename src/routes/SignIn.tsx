import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Icon } from '@/components/Icon'
import { useSession } from '@/lib/session'

export function SignIn() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()
  const signIn = useSession((s) => s.signIn)
  const bootstrap = useSession((s) => s.bootstrap)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await signIn(email, password)
      navigate('/map', { replace: true })
    } catch {
      setError('Invalid email or password')
    } finally {
      setBusy(false)
    }
  }

  async function handleBootstrap() {
    setError(null)
    setBusy(true)
    try {
      await bootstrap()
      navigate('/map', { replace: true })
    } catch {
      setError('Could not continue — please try again')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <h1 style={{ fontSize: 18, fontWeight: 700, marginBottom: 24, textAlign: 'center' }}>
        Sign in to your account
      </h1>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <label htmlFor="email" style={label}>Email</label>
          <div className="field-shell" style={field}>
            <Icon name="Mail" size={17} color="var(--muted)" />
            <input id="email" type="email" required value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com" style={input}
              autoComplete="email" disabled={busy} />
          </div>
        </div>

        <div>
          <label htmlFor="password" style={label}>Password</label>
          <div className="field-shell" style={field}>
            <Icon name="Lock" size={17} color="var(--muted)" />
            <input id="password" type={showPw ? 'text' : 'password'} required
              value={password} onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••" style={input}
              autoComplete="current-password" disabled={busy} />
            <button type="button" onClick={() => setShowPw(!showPw)}
              aria-label={showPw ? 'Hide password' : 'Show password'} style={toggle}>
              <Icon name={showPw ? 'EyeOff' : 'Eye'} size={17} color="var(--muted)" />
            </button>
          </div>
        </div>

        {error && (
          <p role="alert" style={{
            fontSize: 13, color: 'var(--red-text)', background: 'var(--red-light)',
            padding: '10px 14px', borderRadius: 'var(--r-button)',
            border: '1px solid var(--red-border)',
          }}>
            {error}
          </p>
        )}

        <button type="submit" disabled={busy || !email || !password} style={{
          ...primary, opacity: (busy || !email || !password) ? 0.6 : 1,
        }}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '20px 0' }}>
        <span style={{ flex: 1, height: 1, background: 'var(--border)' }} />
        <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 500 }}>or</span>
        <span style={{ flex: 1, height: 1, background: 'var(--border)' }} />
      </div>

      <button onClick={handleBootstrap} disabled={busy} style={secondary}>
        <Icon name="Smartphone" size={17} />
        Continue without an account
      </button>

      <p style={{ fontSize: 13, color: 'var(--muted)', textAlign: 'center', marginTop: 20 }}>
        Don&apos;t have an account?{' '}
        <Link to="/auth/create" style={link}>Create one</Link>
      </p>

      {import.meta.env.DEV && (
        <p style={{ fontSize: 11, color: 'var(--muted)', textAlign: 'center', marginTop: 12 }}>
          Demo: nadia@example.org / demo1234
        </p>
      )}
    </>
  )
}

const label: React.CSSProperties = {
  display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6, color: 'var(--body)',
}
const field: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10,
  border: '1px solid var(--control-border)', borderRadius: 'var(--r-input)',
  padding: '0 12px', height: 'var(--h-primary)', background: 'var(--surface)',
}
const input: React.CSSProperties = {
  flex: 1, minWidth: 0, width: '100%', border: 'none', outline: 'none', background: 'transparent',
  fontSize: 14, fontFamily: 'inherit', color: 'var(--ink)',
}
const toggle: React.CSSProperties = {
  width: 44, height: 44, flexShrink: 0, background: 'none', border: 'none', cursor: 'pointer', padding: 0,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
}
const primary: React.CSSProperties = {
  height: 'var(--h-primary)', borderRadius: 'var(--r-button)',
  background: 'var(--green)', color: '#fff', border: 'none',
  fontSize: 14, fontWeight: 600, cursor: 'pointer',
}
const secondary: React.CSSProperties = {
  width: '100%', height: 'var(--h-primary)', borderRadius: 'var(--r-button)',
  background: 'var(--surface)', color: 'var(--body)', border: '1px solid var(--control-border)',
  fontSize: 14, fontWeight: 500, cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
}
const link: React.CSSProperties = {
  color: 'var(--green-dark)', fontWeight: 600, textDecoration: 'underline', textUnderlineOffset: 2,
}
