import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Icon } from '@/components/Icon'
import { useSession } from '@/lib/session'
import { ApiError } from '@/lib/api'
import type { Role } from '@/types'

type SelectableRole = Extract<Role, 'Detector' | 'Volunteer' | 'Coordinator'>

const ROLES: { value: SelectableRole; label: string; desc: string }[] = [
  { value: 'Detector', label: 'Detector', desc: 'Report invasive plant sightings' },
  { value: 'Volunteer', label: 'Volunteer', desc: 'Report and join trail cleanup teams' },
  { value: 'Coordinator', label: 'Coordinator', desc: 'Verify reports, manage monitored areas' },
]

export function CreateAccount() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [role, setRole] = useState<SelectableRole>('Volunteer')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()
  const register = useSession((s) => s.register)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await register(name, email, password, role)
      navigate('/map', { replace: true })
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setError('An account with this email already exists')
      } else {
        setError('Something went wrong — please try again')
      }
    } finally {
      setBusy(false)
    }
  }

  const canSubmit = name && email && password.length >= 8

  return (
    <>
      <h1 style={{ fontSize: 18, fontWeight: 700, marginBottom: 24, textAlign: 'center' }}>
        Create your account
      </h1>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <label htmlFor="name" style={labelSt}>Full name</label>
          <div className="field-shell" style={field}>
            <Icon name="User" size={17} color="var(--muted)" />
            <input id="name" type="text" required value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name" style={input}
              autoComplete="name" disabled={busy} />
          </div>
        </div>

        <div>
          <label htmlFor="reg-email" style={labelSt}>Email</label>
          <div className="field-shell" style={field}>
            <Icon name="Mail" size={17} color="var(--muted)" />
            <input id="reg-email" type="email" required value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com" style={input}
              autoComplete="email" disabled={busy} />
          </div>
        </div>

        <div>
          <label htmlFor="reg-password" style={labelSt}>Password</label>
          <div className="field-shell" style={field}>
            <Icon name="Lock" size={17} color="var(--muted)" />
            <input id="reg-password" type={showPw ? 'text' : 'password'} required
              value={password} onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters" style={input}
              autoComplete="new-password" minLength={8} disabled={busy} />
            <button type="button" onClick={() => setShowPw(!showPw)}
              aria-label={showPw ? 'Hide password' : 'Show password'} style={toggle}>
              <Icon name={showPw ? 'EyeOff' : 'Eye'} size={17} color="var(--muted)" />
            </button>
          </div>
        </div>

        <fieldset style={{ border: 'none', padding: 0 }}>
          <legend style={{ ...labelSt, marginBottom: 10 }}>Role</legend>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {ROLES.map((r) => (
              <label key={r.value} className="radio-card" style={{
                display: 'flex', alignItems: 'flex-start', gap: 10,
                padding: '10px 12px', borderRadius: 'var(--r-button)',
                border: `1.5px solid ${role === r.value ? 'var(--green)' : 'var(--control-border)'}`,
                background: role === r.value ? 'var(--green-light)' : 'var(--surface)',
                cursor: 'pointer', transition: 'border-color 0.15s, background 0.15s',
              }}>
                <input type="radio" name="role" value={r.value}
                  checked={role === r.value}
                  onChange={() => setRole(r.value)}
                  style={{ accentColor: 'var(--green)', marginTop: 2 }}
                  disabled={busy} />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{r.label}</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{r.desc}</div>
                </div>
              </label>
            ))}
          </div>
        </fieldset>

        {error && (
          <p role="alert" style={{
            fontSize: 13, color: 'var(--red-text)', background: 'var(--red-light)',
            padding: '10px 14px', borderRadius: 'var(--r-button)',
            border: '1px solid var(--red-border)',
          }}>
            {error}
          </p>
        )}

        <button type="submit" disabled={busy || !canSubmit} style={{
          ...primary, opacity: (busy || !canSubmit) ? 0.6 : 1,
        }}>
          {busy ? 'Creating account…' : 'Create account'}
        </button>
      </form>

      <p style={{ fontSize: 13, color: 'var(--muted)', textAlign: 'center', marginTop: 20 }}>
        Already have an account?{' '}
        <Link to="/auth/sign-in" style={linkSt}>Sign in</Link>
      </p>
    </>
  )
}

const labelSt: React.CSSProperties = {
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
const linkSt: React.CSSProperties = {
  color: 'var(--green-dark)', fontWeight: 600, textDecoration: 'underline', textUnderlineOffset: 2,
}
