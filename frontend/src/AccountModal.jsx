import { useEffect, useState } from 'react'
import {
  applyReferralCode,
  confirmPasswordReset,
  createBillingPortalSession,
  createCheckoutSession,
  requestPasswordReset,
  resendVerificationEmail,
  startOfflineTrial,
  subscriberLogin,
  subscriberLogout,
  subscriberRegister,
} from './api'
import { getSavedReferralCode } from './joinUrl'
import { PASS_LABEL, PASS_PERIOD, PASS_PRICE, TRIAL_DAYS, getPassStatusInfo } from './passBenefits'
import GCashPayPanel from './GCashPayPanel'
import GoogleAuthButton from './GoogleAuthButton'

function formatTrialEnd(iso) {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
  } catch {
    return ''
  }
}

/**
 * Sign up / log in / checkout / password reset — opened after Pass modal Get Pass / Log in.
 */
export default function AccountModal({
  onClose,
  account,
  onAccountChange,
  initialMode = 'register',
  initialResetToken = '',
  syncingOffline = false,
  onSaveOffline,
}) {
  const [mode, setMode] = useState(() => {
    if (account?.authenticated) return 'subscribe'
    if (initialResetToken) return 'reset'
    if (initialMode === 'login') return 'login'
    if (initialMode === 'forgot') return 'forgot'
    if (initialMode === 'reset') return 'reset'
    return 'register'
  })
  const [resetToken, setResetToken] = useState(initialResetToken || '')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [showGCashPay, setShowGCashPay] = useState(false)

  // Referral states
  const [referralInput, setReferralInput] = useState(() => getSavedReferralCode())
  const [referralMsg, setReferralMsg] = useState('')
  const [copySuccess, setCopySuccess] = useState(false)

  const loggedIn = Boolean(account?.authenticated)
  const hasAccess = Boolean(account?.offline_access)
  const sub = account?.subscription || {}
  const passStatus = getPassStatusInfo(account)
  const isTrialing = passStatus.statusType === 'trial'
  const trialAvailable = Boolean(sub.trial_available)
  const emailVerified = Boolean(account?.email_verified ?? sub.email_verified)
  const stripeTrial = Boolean(sub.stripe_trial)
  const localTrial = Boolean(sub.local_trial_allowed ?? true)
  const needsEmailVerify = stripeTrial && !emailVerified && !hasAccess

  const myReferralCode = sub.referral_code || ''
  const myReferralUrl = myReferralCode ? `${window.location.origin}/?ref=${myReferralCode}` : ''

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
          referralCode: referralInput,
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

  const handleApplyReferral = async (e) => {
    e.preventDefault()
    if (!referralInput.trim()) return
    setBusy(true)
    setReferralMsg('')
    setError('')
    try {
      const res = await applyReferralCode(referralInput)
      setReferralMsg(res.message || 'Referral applied!')
      onAccountChange?.(res)
    } catch (err) {
      setError(err.message || 'Could not apply referral code.')
    } finally {
      setBusy(false)
    }
  }

  const handleCopyReferralLink = async () => {
    if (!myReferralUrl) return
    try {
      await navigator.clipboard.writeText(myReferralUrl)
      setCopySuccess(true)
      setTimeout(() => setCopySuccess(false), 2500)
    } catch {
      window.prompt('Copy your referral link:', myReferralUrl)
    }
  }

  const handleShareReferral = async () => {
    if (!myReferralUrl) return
    const text = 'Kumanta at mag-search offline sa Platino Songbook! Gamitin ang referral link ko para makakuha ng +3 days free trial extension pareho tayo:'
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Platino Songbook - Free Trial Bonus',
          text,
          url: myReferralUrl,
        })
        return
      } catch {
        // Fallback to copy link
      }
    }
    handleCopyReferralLink()
  }

  const handleStartTrial = async () => {
    setBusy(true)
    setError('')
    try {
      if (stripeTrial && !localTrial) {
        const session = await createCheckoutSession()
        if (session.url) {
          window.location.href = session.url
          return
        }
        setError('Checkout did not return a URL.')
        return
      }
      const data = await startOfflineTrial()
      onAccountChange?.({
        ...account,
        authenticated: true,
        offline_access: data.offline_access,
        subscription: data.subscription,
        email_verified: data.email_verified ?? account?.email_verified,
      })
    } catch (err) {
      setError(err.message || 'Could not start free trial.')
    } finally {
      setBusy(false)
    }
  }

  const handleResendVerify = async () => {
    setBusy(true)
    setError('')
    try {
      const data = await resendVerificationEmail()
      onAccountChange?.(data)
      if (data.verification?.verify_url) {
        setError('')
        window.prompt('Verification link (SMTP not configured):', data.verification.verify_url)
      }
    } catch (err) {
      setError(err.message || 'Could not resend verification.')
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
      onAccountChange?.({ authenticated: false, clear_offline_access: true })
      setMode('login')
    } catch (err) {
      setError(err.message || 'Could not sign out.')
    } finally {
      setBusy(false)
    }
  }

  const handleForgotPassword = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    setReferralMsg('')
    try {
      const res = await requestPasswordReset(email)
      setReferralMsg(res.message || 'Password reset link sent! Check your inbox and spam folder.')
      if (res.reset_info?.reset_url) {
        window.prompt('Password reset link (SMTP test link):', res.reset_info.reset_url)
      }
    } catch (err) {
      setError(err.message || 'Could not request password reset.')
    } finally {
      setBusy(false)
    }
  }

  const handleResetPassword = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const next = await confirmPasswordReset({
        token: resetToken,
        newPassword: password,
        confirmPassword: confirm,
      })
      onAccountChange?.(next)
      setPassword('')
      setConfirm('')
      setResetToken('')
      setMode('subscribe')
    } catch (err) {
      setError(err.message || 'Could not reset password.')
    } finally {
      setBusy(false)
    }
  }

  const title = hasAccess
    ? isTrialing
      ? 'Free trial active'
      : passStatus.formattedEnd
        ? `Activated until ${passStatus.formattedEnd}`
        : 'Offline unlocked'
    : loggedIn
      ? needsEmailVerify
        ? 'Verify your email'
        : trialAvailable
          ? `Start ${TRIAL_DAYS}-day free trial`
          : 'Subscribe to Offline Pass'
      : mode === 'register'
        ? 'Create your account'
        : mode === 'forgot'
          ? 'Reset your password'
          : mode === 'reset'
            ? 'Set new password'
            : 'Log in to continue'

  const lead = hasAccess
    ? isTrialing
      ? `${passStatus.statusText}. Save the catalog now — then pay via GCash for continuous access.`
      : passStatus.formattedEnd
        ? `Activated until ${passStatus.formattedEnd}. Save the full song catalog on this device — searchable without Wi‑Fi.`
        : 'Save the full song catalog on this device — searchable without Wi‑Fi.'
    : loggedIn
      ? needsEmailVerify
        ? 'I-check ang inbox mo (and spam). Kailangan i-verify ang email bago ang paid checkout.'
        : trialAvailable
          ? `${TRIAL_DAYS}-day free trial — no card. After trial, pay via GCash and admin will activate.`
          : 'Trial used na — bayad via GCash then ask admin to Activate your email.'
      : mode === 'register'
        ? `Sign up and get a ${TRIAL_DAYS}-day free trial right away.`
        : mode === 'forgot'
          ? 'Ilagay ang iyong registered email para magpadala kami ng password reset link.'
          : mode === 'reset'
            ? 'Gumawa ng bagong secure password para sa iyong account (at least 8 characters).'
            : 'Log in with your existing account.'

  const kicker = hasAccess
    ? (isTrialing ? 'Trial' : 'Active')
    : loggedIn
      ? 'Account'
      : mode === 'forgot'
        ? 'Recovery'
        : mode === 'reset'
          ? 'Security'
          : 'Account'

  const statusLine = passStatus.statusText

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

        <header className="account-modal-header account-modal-header--auth">
          <p className="account-modal-kicker">{kicker}</p>
          <h2 id="account-modal-title">{title}</h2>
          <p className="account-modal-lead">{lead}</p>
        </header>

        {error ? (
          <p className="account-modal-error" role="alert">
            {error}
          </p>
        ) : null}

        {referralMsg ? (
          <p className="account-modal-success" role="status">
            {referralMsg}
          </p>
        ) : null}

        {!loggedIn ? (
          mode === 'forgot' ? (
            <form className="account-modal-form" onSubmit={handleForgotPassword}>
              <label className="account-field" htmlFor="account-forgot-email">
                <span>Email address</span>
                <input
                  id="account-forgot-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </label>

              <button type="submit" className="account-primary-btn" disabled={busy}>
                {busy ? 'Sending link…' : 'Send Reset Link'}
              </button>

              <div className="account-form-footer-nav">
                <button
                  type="button"
                  className="account-text-btn"
                  onClick={() => {
                    setMode('login')
                    setError('')
                    setReferralMsg('')
                  }}
                >
                  ← Back to Log in
                </button>
              </div>
            </form>
          ) : mode === 'reset' ? (
            <form className="account-modal-form" onSubmit={handleResetPassword}>
              <label className="account-field" htmlFor="account-reset-token">
                <span>Reset token</span>
                <input
                  id="account-reset-token"
                  name="reset_token"
                  type="text"
                  placeholder="Paste reset token if not in link"
                  value={resetToken}
                  onChange={(e) => setResetToken(e.target.value)}
                  required
                />
              </label>

              <label className="account-field" htmlFor="account-new-password">
                <span>New password</span>
                <div className="account-password-row">
                  <input
                    id="account-new-password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
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

              <label className="account-field" htmlFor="account-reset-confirm">
                <span>Confirm new password</span>
                <input
                  id="account-reset-confirm"
                  name="confirm_password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  placeholder="Repeat new password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  minLength={8}
                />
              </label>

              <button type="submit" className="account-primary-btn" disabled={busy}>
                {busy ? 'Saving new password…' : 'Save Password & Log In'}
              </button>

              <div className="account-form-footer-nav">
                <button
                  type="button"
                  className="account-text-btn"
                  onClick={() => {
                    setMode('login')
                    setError('')
                    setReferralMsg('')
                  }}
                >
                  ← Back to Log in
                </button>
              </div>
            </form>
          ) : (
            <form className="account-modal-form" onSubmit={handleAuth}>
              <div className="account-mode-tabs" role="tablist" aria-label="Account mode">
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
              </div>

              <GoogleAuthButton
                referralCode={referralInput}
                disabled={busy}
                text={mode === 'register' ? 'Sign up with Google' : 'Continue with Google'}
                onSuccess={(next) => {
                  onAccountChange?.(next)
                  setMode('subscribe')
                }}
                onError={(msg) => setError(msg)}
              />

              <div className="account-divider">
                <span>or continue with email</span>
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
                <div className="account-password-row">
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
                    enterKeyHint={mode === 'register' ? 'next' : 'done'}
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

              {mode === 'login' ? (
                <div className="account-forgot-row">
                  <button
                    type="button"
                    className="account-forgot-btn"
                    onClick={() => {
                      setMode('forgot')
                      setError('')
                      setReferralMsg('')
                    }}
                  >
                    Forgot password?
                  </button>
                </div>
              ) : null}

              {mode === 'register' ? (
                <>
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

                  <label className="account-field" htmlFor="account-referral">
                    <span>Referral Code (Optional)</span>
                    <input
                      id="account-referral"
                      name="referral_code"
                      type="text"
                      placeholder="e.g. REF8A3F (+3 days trial)"
                      value={referralInput}
                      onChange={(e) => setReferralInput(e.target.value.toUpperCase())}
                    />
                  </label>
                </>
              ) : null}

              <button type="submit" className="account-primary-btn" disabled={busy}>
                {busy
                  ? 'Please wait…'
                  : mode === 'register'
                    ? `Sign up · ${TRIAL_DAYS}-day trial`
                    : 'Log in'}
              </button>

              <p className="account-modal-footnote">
                {mode === 'register'
                  ? `Free trial starts immediately · then ${PASS_LABEL} via GCash/admin`
                  : `Offline Pass · ${PASS_PRICE}${PASS_PERIOD} (manual activate)`}
              </p>
            </form>
          )
        ) : (
          <div className="account-signed-in">
            <div className={`account-status-chip ${hasAccess ? (isTrialing ? 'is-trial' : 'is-active') : 'is-locked'}`}>
              <span className="account-status-dot" aria-hidden="true" />
              <div>
                <strong>{account.email || account.username}</strong>
                <p>{statusLine}</p>
              </div>
            </div>

            {/* Invite a Friend Referral Section */}
            <div className="referral-card">
              <div className="referral-card-header">
                <span className="referral-card-badge">🎁 Invite & Earn</span>
                <h3>Invite a friend (+3 days trial)</h3>
                <p>Pareho kayong makakakuha ng +3 days trial extension kapag nag-join ang kaibigan mo!</p>
              </div>

              {myReferralCode ? (
                <div className="referral-box">
                  <div className="referral-code-display">
                    <span>Your Code:</span>
                    <strong>{myReferralCode}</strong>
                  </div>
                  <div className="referral-actions">
                    <button
                      type="button"
                      className="referral-btn copy-btn"
                      onClick={handleCopyReferralLink}
                    >
                      {copySuccess ? 'Copied link! ✓' : '📋 Copy Link'}
                    </button>
                    <button
                      type="button"
                      className="referral-btn share-btn"
                      onClick={handleShareReferral}
                    >
                      📱 Share
                    </button>
                  </div>
                  <div className="referral-stats">
                    <span>👥 {sub.referral_count || 0} friends invited</span>
                    <span>🎁 +{sub.referral_days_earned || 0} days earned</span>
                  </div>
                </div>
              ) : null}

              {!sub.referred_by ? (
                <form className="referral-apply-form" onSubmit={handleApplyReferral}>
                  <label htmlFor="enter-friend-code">Have a friend's code?</label>
                  <div className="referral-input-group">
                    <input
                      id="enter-friend-code"
                      type="text"
                      placeholder="Enter Referral Code"
                      value={referralInput}
                      onChange={(e) => setReferralInput(e.target.value.toUpperCase())}
                    />
                    <button type="submit" className="referral-submit-btn" disabled={busy || !referralInput.trim()}>
                      Apply
                    </button>
                  </div>
                </form>
              ) : (
                <p className="referral-referred-by">
                  ✓ Referred by <strong>{sub.referred_by}</strong> (+3 bonus days claimed)
                </p>
              )}
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
                {isTrialing ? (
                  <>
                    <p className="account-modal-footnote">
                      Free trial — auto-expires after {TRIAL_DAYS} days (back to free plan).
                    </p>
                    {!showGCashPay ? (
                      <button
                        type="button"
                        className="account-ghost-btn"
                        onClick={() => setShowGCashPay(true)}
                      >
                        Subscribe now
                      </button>
                    ) : (
                      <GCashPayPanel />
                    )}
                  </>
                ) : stripeTrial ? (
                  <button
                    type="button"
                    className="account-ghost-btn"
                    onClick={handlePortal}
                    disabled={busy}
                  >
                    Manage billing
                  </button>
                ) : null}
              </>
            ) : needsEmailVerify ? (
              <>
                <button
                  type="button"
                  className="account-primary-btn"
                  onClick={handleResendVerify}
                  disabled={busy}
                >
                  {busy ? 'Sending…' : 'Resend verification email'}
                </button>
                <p className="account-modal-footnote">
                  Open the link in your email to continue.
                </p>
              </>
            ) : (
              <>
                <div className="account-plan-card">
                  <div>
                    <p className="account-plan-name">Offline Pass</p>
                    <p className="account-plan-desc">
                      {trialAvailable
                        ? `${TRIAL_DAYS}-day free trial available`
                        : `Activate for ${PASS_PRICE}${PASS_PERIOD} via GCash`}
                    </p>
                  </div>
                  <p className="account-plan-price">
                    {PASS_PRICE}
                    <em>{PASS_PERIOD}</em>
                  </p>
                </div>
                {trialAvailable ? (
                  <button
                    type="button"
                    className="account-primary-btn"
                    onClick={handleStartTrial}
                    disabled={busy}
                  >
                    {busy ? 'Starting…' : `Start ${TRIAL_DAYS}-day free trial`}
                  </button>
                ) : null}
                {!showGCashPay ? (
                  <button
                    type="button"
                    className={trialAvailable ? 'account-ghost-btn' : 'account-primary-btn'}
                    onClick={() => setShowGCashPay(true)}
                  >
                    {trialAvailable
                      ? 'Skip trial · Subscribe now'
                      : 'Subscribe now'}
                  </button>
                ) : (
                  <GCashPayPanel />
                )}
                {stripeTrial ? (
                  <button
                    type="button"
                    className="account-ghost-btn"
                    onClick={handleCheckout}
                    disabled={busy}
                  >
                    {busy ? 'Redirecting…' : 'Stripe checkout'}
                  </button>
                ) : null}
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
