import { useEffect, useRef, useState } from 'react'
import { adminLogout, changeAdminPassword } from '../api'
import AdminSongs from './AdminSongs'
import AdminReports from './AdminReports'
import AdminOnline from './AdminOnline'
import AdminAnalytics from './AdminAnalytics'
import AdminSubscribers from './AdminSubscribers'
import JoinQrModal from '../JoinQrModal'

const EMPTY_PASSWORD_FORM = {
  currentPassword: '',
  newPassword: '',
  confirmPassword: '',
}

export default function AdminDashboard({ user, onBack, onLogout }) {
  const [tab, setTab] = useState('songs')
  const [toast, setToast] = useState(null)
  const [showJoinQr, setShowJoinQr] = useState(false)
  const [showPasswordModal, setShowPasswordModal] = useState(false)
  const [passwordForm, setPasswordForm] = useState(EMPTY_PASSWORD_FORM)
  const [passwordError, setPasswordError] = useState('')
  const [passwordBusy, setPasswordBusy] = useState(false)
  const [showPasswords, setShowPasswords] = useState(false)
  const toastTimer = useRef(null)
  const username = user?.username || 'admin'
  const initial = username.slice(0, 1).toUpperCase()

  useEffect(() => {
    return () => {
      if (toastTimer.current) window.clearTimeout(toastTimer.current)
    }
  }, [])

  const showToast = (input) => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current)
    const next =
      typeof input === 'string'
        ? { message: input }
        : {
            message: input?.message || '',
            undo: typeof input?.undo === 'function' ? input.undo : null,
          }
    setToast(next)
    toastTimer.current = window.setTimeout(
      () => setToast(null),
      next.undo ? 5000 : 3200,
    )
  }

  const handleUndo = async () => {
    if (!toast?.undo) return
    const undoFn = toast.undo
    setToast(null)
    if (toastTimer.current) window.clearTimeout(toastTimer.current)
    try {
      await undoFn()
    } catch (err) {
      showToast(err.message || 'Undo failed.')
    }
  }

  const openPasswordModal = () => {
    setPasswordForm(EMPTY_PASSWORD_FORM)
    setPasswordError('')
    setShowPasswords(false)
    setShowPasswordModal(true)
  }

  const closePasswordModal = () => {
    if (passwordBusy) return
    setShowPasswordModal(false)
    setPasswordForm(EMPTY_PASSWORD_FORM)
    setPasswordError('')
  }

  const handleChangePassword = async (e) => {
    e.preventDefault()
    setPasswordBusy(true)
    setPasswordError('')
    try {
      const result = await changeAdminPassword(passwordForm)
      setShowPasswordModal(false)
      setPasswordForm(EMPTY_PASSWORD_FORM)
      showToast(result.message || 'Password updated.')
    } catch (err) {
      setPasswordError(err.message || 'Could not change password.')
    } finally {
      setPasswordBusy(false)
    }
  }

  const handleLogout = async () => {
    try {
      await adminLogout()
    } catch {
      // still leave the UI
    }
    onLogout?.()
  }

  return (
    <div className="admin-dash">
      <div className="admin-dash-shell">
        <header className="admin-dash-header">
          <div className="admin-dash-brand">
            <p className="admin-dash-kicker">The Platinum Karaoke</p>
            <h1 className="admin-dash-title">Control Room</h1>
          </div>

          <div className="admin-dash-side">
            <button
              type="button"
              className="admin-user-chip clickable"
              onClick={openPasswordModal}
              title="Change password"
            >
              <span className="admin-user-avatar" aria-hidden="true">
                {initial}
              </span>
              <span className="admin-user-meta">
                <span className="admin-user-label">Signed in</span>
                <strong className="admin-user-name">{username}</strong>
              </span>
            </button>

            <div className="admin-dash-actions">
              <button type="button" className="admin-nav-btn" onClick={() => setShowJoinQr(true)}>
                QR Join
              </button>
              <button type="button" className="admin-nav-btn" onClick={openPasswordModal}>
                Password
              </button>
              <button type="button" className="admin-nav-btn" onClick={onBack}>
                <span className="admin-nav-btn-icon" aria-hidden="true">
                  ←
                </span>
                Songbook
              </button>
              <button type="button" className="admin-nav-btn danger" onClick={handleLogout}>
                Sign out
              </button>
            </div>
          </div>
        </header>

        <nav className="admin-tabs admin-tabs-five" aria-label="Admin sections">
          <button
            type="button"
            className={`admin-tab ${tab === 'songs' ? 'active' : ''}`}
            onClick={() => setTab('songs')}
          >
            <span className="admin-tab-label">Songs</span>
            <span className="admin-tab-hint">Catalog</span>
          </button>
          <button
            type="button"
            className={`admin-tab ${tab === 'reports' ? 'active' : ''}`}
            onClick={() => setTab('reports')}
          >
            <span className="admin-tab-label">Reports</span>
            <span className="admin-tab-hint">Reviews</span>
          </button>
          <button
            type="button"
            className={`admin-tab ${tab === 'subscribers' ? 'active' : ''}`}
            onClick={() => setTab('subscribers')}
          >
            <span className="admin-tab-label">Subscribers</span>
            <span className="admin-tab-hint">Offline Pass</span>
          </button>
          <button
            type="button"
            className={`admin-tab ${tab === 'online' ? 'active' : ''}`}
            onClick={() => setTab('online')}
          >
            <span className="admin-tab-label">Online</span>
            <span className="admin-tab-hint">Live</span>
          </button>
          <button
            type="button"
            className={`admin-tab ${tab === 'insights' ? 'active' : ''}`}
            onClick={() => setTab('insights')}
          >
            <span className="admin-tab-label">Insights</span>
            <span className="admin-tab-hint">Stats</span>
          </button>
        </nav>

        <main className="admin-dash-main">
          {tab === 'songs' ? <AdminSongs onToast={showToast} /> : null}
          {tab === 'reports' ? <AdminReports onToast={showToast} /> : null}
          {tab === 'subscribers' ? <AdminSubscribers onToast={showToast} /> : null}
          {tab === 'online' ? <AdminOnline /> : null}
          {tab === 'insights' ? <AdminAnalytics /> : null}
        </main>
      </div>

      {showPasswordModal ? (
        <div className="drawer-overlay" onClick={closePasswordModal}>
          <div
            className="modal-card admin-form-modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-labelledby="change-password-title"
          >
            <div className="drawer-header">
              <div>
                <h2 id="change-password-title">Change password</h2>
                <p>Update the password for {username}.</p>
              </div>
              <button type="button" className="close-drawer-btn" onClick={closePasswordModal}>
                X
              </button>
            </div>
            <form className="report-form" onSubmit={handleChangePassword}>
              <label htmlFor="admin-current-password">
                Current password
                <input
                  id="admin-current-password"
                  name="current_password"
                  type={showPasswords ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  value={passwordForm.currentPassword}
                  onChange={(e) =>
                    setPasswordForm((f) => ({ ...f, currentPassword: e.target.value }))
                  }
                />
              </label>
              <label htmlFor="admin-new-password">
                New password
                <input
                  id="admin-new-password"
                  name="new_password"
                  type={showPasswords ? 'text' : 'password'}
                  autoComplete="new-password"
                  required
                  minLength={8}
                  value={passwordForm.newPassword}
                  onChange={(e) =>
                    setPasswordForm((f) => ({ ...f, newPassword: e.target.value }))
                  }
                />
              </label>
              <label htmlFor="admin-confirm-password">
                Confirm new password
                <input
                  id="admin-confirm-password"
                  name="confirm_password"
                  type={showPasswords ? 'text' : 'password'}
                  autoComplete="new-password"
                  required
                  minLength={8}
                  value={passwordForm.confirmPassword}
                  onChange={(e) =>
                    setPasswordForm((f) => ({ ...f, confirmPassword: e.target.value }))
                  }
                />
              </label>

              <label className="admin-password-toggle" htmlFor="admin-show-passwords">
                <input
                  id="admin-show-passwords"
                  name="show_passwords"
                  type="checkbox"
                  checked={showPasswords}
                  onChange={(e) => setShowPasswords(e.target.checked)}
                />
                Show passwords
              </label>

              {passwordError ? (
                <p className="admin-inline-error" role="alert">
                  {passwordError}
                </p>
              ) : null}

              <div className="admin-confirm-actions">
                <button
                  type="button"
                  className="admin-action-btn ghost"
                  onClick={closePasswordModal}
                  disabled={passwordBusy}
                >
                  Cancel
                </button>
                <button type="submit" className="admin-action-btn" disabled={passwordBusy}>
                  {passwordBusy ? 'Saving…' : 'Update password'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {showJoinQr ? (
        <JoinQrModal onClose={() => setShowJoinQr(false)} />
      ) : null}

      {toast?.message ? (
        <div
          className={`admin-snackbar ${toast.undo ? 'has-undo' : ''}`}
          role="status"
          key={`${toast.message}-${Boolean(toast.undo)}`}
        >
          <div className="admin-snackbar-inner">
            <div className="admin-snackbar-copy">
              <span className="admin-snackbar-label">
                {toast.undo ? 'Deleted' : 'Notice'}
              </span>
              <p className="admin-snackbar-message">{toast.message}</p>
            </div>
            {toast.undo ? (
              <button type="button" className="admin-snackbar-undo" onClick={handleUndo}>
                Undo
              </button>
            ) : null}
          </div>
          {toast.undo ? <span className="admin-snackbar-timer" aria-hidden="true" /> : null}
        </div>
      ) : null}
    </div>
  )
}
