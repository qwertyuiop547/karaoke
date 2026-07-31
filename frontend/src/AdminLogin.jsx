import { useEffect, useRef, useState } from 'react'
import gsap from 'gsap'
import { useGSAP } from '@gsap/react'
import { fetchCsrf, adminLogin } from './api'

gsap.registerPlugin(useGSAP)

export default function AdminLogin({ onBack, onSuccess }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const pageRef = useRef(null)

  useEffect(() => {
    fetchCsrf().catch(() => {})
  }, [])

  useGSAP(
    () => {
      const root = pageRef.current
      if (!root?.querySelector('.admin-login-shell')) return

      const skipMotion =
        window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
        window.matchMedia('(pointer: coarse), (max-width: 820px)').matches
      if (skipMotion) return

      const q = (sel) => root.querySelectorAll(sel)
      if (!q('.admin-brand-panel').length || !q('.admin-form-panel').length) return

      const tl = gsap.timeline({
        defaults: { ease: 'power3.out' },
        onComplete: () => {
          if (!pageRef.current) return
          gsap.set(
            pageRef.current.querySelectorAll(
              '.admin-brand-panel, .admin-form-panel, .admin-form-panel > *',
            ),
            { clearProps: 'transform,opacity' },
          )
        },
      })

      tl.fromTo(
        q('.admin-brand-panel'),
        { opacity: 0, x: -24 },
        { opacity: 1, x: 0, duration: 0.6 },
      )
        .fromTo(
          q('.admin-brand-title, .admin-brand-copy'),
          { opacity: 0, y: 14 },
          { opacity: 1, y: 0, stagger: 0.08, duration: 0.4 },
          '-=0.35',
        )
        .fromTo(
          q('.admin-form-panel'),
          { opacity: 0, x: 24 },
          { opacity: 1, x: 0, duration: 0.6 },
          '-=0.45',
        )
        .fromTo(
          q('.admin-form-panel > *'),
          { opacity: 0, y: 10 },
          { opacity: 1, y: 0, stagger: 0.05, duration: 0.3 },
          '-=0.3',
        )
    },
    { scope: pageRef },
  )

  const handleSubmit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const data = await adminLogin(username.trim(), password)
      onSuccess?.(data)
    } catch (err) {
      setError(err.message || 'Login failed.')
      setBusy(false)
    }
  }

  return (
    <div className="admin-login-page" ref={pageRef}>
      <div className="admin-login-shell">
        <aside className="admin-brand-panel" aria-hidden="true">
          <div className="admin-brand-stage">
            <div className="admin-brand-glow" />
            <div className="admin-brand-ring" />
            <div className="admin-brand-mic">
              <svg viewBox="0 0 64 64" fill="none">
                <circle cx="32" cy="26" r="12" stroke="currentColor" strokeWidth="2.5" />
                <path
                  d="M20 28v2a12 12 0 0 0 24 0v-2M32 42v10M22 52h20"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                />
              </svg>
            </div>
          </div>

          <div className="admin-brand-content">
            <p className="admin-brand-kicker">Official directory</p>
            <h1 className="admin-brand-title">
              Platinum
              <span>Karaoke</span>
            </h1>
            <p className="admin-brand-copy">
              Sign in to manage song numbers, upload catalogs, and clear user reports.
            </p>
          </div>
        </aside>

        <section className="admin-form-panel">
          <button type="button" className="admin-login-back" onClick={onBack}>
            ← Back to Songbook
          </button>

          <p className="admin-login-badge">Admin access</p>
          <h2 className="admin-login-heading">Sign in</h2>
          <p className="admin-login-sub">Use your staff account to open the dashboard.</p>

          <form className="admin-login-form" onSubmit={handleSubmit}>
            <label htmlFor="admin-username">
              <span>Username</span>
              <div className="admin-input-wrap">
                <svg className="admin-input-icon" viewBox="0 0 24 24" aria-hidden="true">
                  <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="1.8" fill="none" />
                  <path
                    d="M4 20c1.5-4 4.5-6 8-6s6.5 2 8 6"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    fill="none"
                    strokeLinecap="round"
                  />
                </svg>
                <input
                  id="admin-username"
                  name="username"
                  type="text"
                  autoComplete="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Enter username"
                  required
                />
              </div>
            </label>

            <label htmlFor="admin-password">
              <span>Password</span>
              <div className="admin-input-wrap">
                <svg className="admin-input-icon" viewBox="0 0 24 24" aria-hidden="true">
                  <rect
                    x="5"
                    y="11"
                    width="14"
                    height="10"
                    rx="2"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    fill="none"
                  />
                  <path
                    d="M8 11V8a4 4 0 0 1 8 0v3"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    fill="none"
                    strokeLinecap="round"
                  />
                </svg>
                <input
                  id="admin-password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter password"
                  required
                />
                <button
                  type="button"
                  className="admin-eye-btn"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
            </label>

            {error ? (
              <p className="admin-login-error" role="alert">
                {error}
              </p>
            ) : null}

            <button type="submit" className="admin-login-submit" disabled={busy}>
              {busy ? 'Signing in…' : 'Enter Dashboard'}
            </button>
          </form>

        </section>
      </div>
    </div>
  )
}
