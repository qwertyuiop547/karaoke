import { useState } from 'react'
import {
  createBillingPortalSession,
  createCheckoutSession,
  subscriberLogin,
  subscriberLogout,
  subscriberRegister,
} from './api'

const PASS_PRICE = import.meta.env.VITE_OFFLINE_PASS_PRICE || '₱199'
const PASS_PERIOD = import.meta.env.VITE_OFFLINE_PASS_PERIOD || '/mo'
const PASS_LABEL =
  import.meta.env.VITE_OFFLINE_PASS_LABEL || `Offline Pass · ${PASS_PRICE}${PASS_PERIOD}`

/**
 * Account + Offline Pass paywall (separate from staff AdminGate).
 */
export default function AccountModal({
  onClose,
  account,
  onAccountChange,
  initialMode = 'login',
  syncingOffline = false,
  onSaveOffline,
}) {
  const [mode, setMode] = useState(() => {
    if (account?.authenticated) return 'subscribe'
    return initialMode
  })
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const loggedIn = Boolean(account?.authenticated)
  const hasAccess = Boolean(account?.offline_access)

  const handleAuth = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      let next
      if (mode === 'register') {
        next = await subscriberRegister({
          email,
          password,
          confirmPassword: confirm,
        })
      } else {
        next = await subscriberLogin(email, password)
      }
      onAccountChange?.(next)
      setPassword('')
      setConfirm('')
      setMode('subscribe')
    } catch (err) {
      setError(err.message || 'Authentication failed.')
    } finally {
      setBusy(false)
    }
  }

  const handleCheckout = async () => {
    setBusy(true)
    setError('')
    try {
      const session = await createCheckoutSession()
      if (session.url) {
        window.location.href = session.url
        return
      }
      setError('Checkout did not return a URL.')
    } catch (err) {
      setError(err.message || 'Could not start checkout.')
    } finally {
      setBusy(false)
    }
  }

  const handlePortal = async () => {
    setBusy(true)
    setError('')
    try {
      const session = await createBillingPortalSession()
      if (session.url) {
        window.location.href = session.url
        return
      }
      setError('Portal did not return a URL.')
    } catch (err) {
      setError(err.message || 'Could not open billing portal.')
    } finally {
      setBusy(false)
    }
  }

  const handleLogout = async () => {
    setBusy(true)
    try {
      await subscriberLogout()
      onAccountChange?.({ authenticated: false })
      setMode('login')
    } catch (err) {
      setError(err.message || 'Could not sign out.')
    } finally {
      setBusy(false)
    }
  }

  const title = hasAccess
    ? 'Offline unlocked'
    : loggedIn
      ? 'Unlock Offline Pass'
      : mode === 'register'
        ? 'Create your account'
        : 'Sign in to continue'

  const lead = hasAccess
    ? 'Save the full song catalog on this device — searchable without Wi‑Fi.'
    : loggedIn
      ? 'Online search stays free. Offline catalog needs an active Offline Pass.'
      : 'Mag-login o mag-sign up para i-unlock ang offline song catalog.'

  return (
    <div className="drawer-overlay install-app-overlay" onClick={onClose}>
      <div
        className="modal-card account-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="account-modal-title"
      >
        <button
          type="button"
          className="account-modal-close"
          onClick={onClose}
          aria-label="Close"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path
              d="M6 6l12 12M18 6L6 18"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </button>

        <div className="account-pass-banner" aria-hidden="true">
          <div className="account-pass-ticket">
            <div className="account-pass-ticket-main">
              <span className="account-pass-brand">Platino</span>
              <strong>Offline Pass</strong>
              <span className="account-pass-price">
                {PASS_PRICE}
                <em>{PASS_PERIOD}</em>
              </span>
            </div>
            <div className="account-pass-stub">
              <svg className="account-pass-mic" viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="9" r="4" fill="none" stroke="currentColor" strokeWidth="1.8" />
                <path
                  d="M12 13v5M8 21h8"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              </svg>
            </div>
          </div>
        </div>

        <header className="account-modal-header">
          <p className="account-modal-kicker">
            {hasAccess ? 'Active' : loggedIn ? 'Subscribe' : 'Account'}
          </p>
          <h2 id="account-modal-title">{title}</h2>
          <p className="account-modal-lead">{lead}</p>
        </header>

        {error ? (
          <p className="account-modal-error" role="alert">
            {error}
          </p>
        ) : null}

        {!loggedIn ? (
          <form className="account-modal-form" onSubmit={handleAuth}>
            <div className="account-mode-tabs" role="tablist" aria-label="Account mode">
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'login'}
                className={mode === 'login' ? 'active' : ''}
                onClick={() => {
                  setMode('login')
                  setError('')
                }}
              >
                Log in
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'register'}
                className={mode === 'register' ? 'active' : ''}
                onClick={() => {
                  setMode('register')
                  setError('')
                }}
              >
                Sign up
              </button>
            </div>

            <label className="account-field" htmlFor="account-email">
              <span>Email</span>
              <input
                id="account-email"
                name="email"
                type="email"
                autoComplete="email"
                placeholder="you@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </label>

            <label className="account-field" htmlFor="account-password">
              <span>Password</span>
              <div className="account-field-password">
                <input
                  id="account-password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                  placeholder="At least 8 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                />
                <button
                  type="button"
                  className="account-toggle-pw"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
            </label>

            {mode === 'register' ? (
              <label className="account-field" htmlFor="account-confirm">
                <span>Confirm password</span>
                <input
                  id="account-confirm"
                  name="confirm_password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  placeholder="Repeat password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  minLength={8}
                />
              </label>
            ) : null}

            <button type="submit" className="account-primary-btn" disabled={busy}>
              {busy ? 'Please wait…' : mode === 'register' ? 'Create account' : 'Log in'}
            </button>

            <p className="account-modal-footnote">
              Free online search · Offline catalog needs {PASS_LABEL}
            </p>
          </form>
        ) : (
          <div className="account-signed-in">
            <div className={`account-status-chip ${hasAccess ? 'is-active' : 'is-locked'}`}>
              <span className="account-status-dot" aria-hidden="true" />
              <div>
                <strong>{account.email || account.username}</strong>
                <p>{hasAccess ? 'Offline Pass active' : 'No active subscription'}</p>
              </div>
            </div>

            {hasAccess ? (
              <>
                <button
                  type="button"
                  className="account-primary-btn"
                  onClick={() => onSaveOffline?.()}
                  disabled={syncingOffline}
                >
                  {syncingOffline ? 'Downloading…' : 'Save Offline Catalog'}
                </button>
                <button
                  type="button"
                  className="account-ghost-btn"
                  onClick={handlePortal}
                  disabled={busy}
                >
                  Manage billing
                </button>
              </>
            ) : (
              <>
                <div className="account-plan-card">
                  <div>
                    <p className="account-plan-name">Offline Pass</p>
                    <p className="account-plan-desc">Full catalog on this device</p>
                  </div>
                  <p className="account-plan-price">
                    {PASS_PRICE}
                    <em>{PASS_PERIOD}</em>
                  </p>
                </div>
                <button
                  type="button"
                  className="account-primary-btn"
                  onClick={handleCheckout}
                  disabled={busy}
                >
                  {busy ? 'Redirecting…' : 'Subscribe now'}
                </button>
                <p className="account-modal-footnote">
                  Or pay via GCash and ask admin to activate your email.
                </p>
              </>
            )}

            <button
              type="button"
              className="account-text-btn"
              onClick={handleLogout}
              disabled={busy}
            >
              Sign out
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
