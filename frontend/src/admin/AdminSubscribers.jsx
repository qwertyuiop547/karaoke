import {
  adminActivateSubscriber,
  listSubscribers,
} from '../api'
import { useEffect, useState } from 'react'

function defaultUntil() {
  const d = new Date()
  d.setMonth(d.getMonth() + 1)
  return d.toISOString().slice(0, 10)
}

function formatDate(value) {
  if (!value) return '—'
  return value.slice(0, 10)
}

export default function AdminSubscribers({ onToast }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [email, setEmail] = useState('')
  const [until, setUntil] = useState(defaultUntil)
  const [busy, setBusy] = useState(false)

  const refresh = async () => {
    setLoading(true)
    setError('')
    try {
      const data = await listSubscribers()
      setRows(data.results || [])
    } catch (err) {
      setError(err.message || 'Could not load subscribers.')
      setRows([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  const handleActivate = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      const result = await adminActivateSubscriber({ email, until })
      onToast?.(
        `Activated ${result.email || result.username} until ${until}`,
      )
      setEmail('')
      await refresh()
    } catch (err) {
      onToast?.(err.message || 'Activate failed.')
    } finally {
      setBusy(false)
    }
  }

  const activateRow = async (row) => {
    setBusy(true)
    try {
      await adminActivateSubscriber({ userId: row.user_id, until })
      onToast?.(`Activated ${row.email} until ${until}`)
      await refresh()
    } catch (err) {
      onToast?.(err.message || 'Activate failed.')
    } finally {
      setBusy(false)
    }
  }

  const activeCount = rows.filter((row) => row.offline_access).length

  return (
    <div className="admin-subscribers">
      <header className="admin-panel-head">
        <div>
          <h2 className="admin-panel-title">Subscribers</h2>
          <p className="admin-panel-sub">
            Offline Pass accounts · manual GCash / bank activation
          </p>
        </div>
        <div className="admin-count-chip" aria-label="Subscriber count">
          <span className="admin-count-value">{loading ? '—' : rows.length}</span>
          <span className="admin-count-label">
            {activeCount ? `${activeCount} active` : 'accounts'}
          </span>
        </div>
      </header>

      <section className="admin-pass-card">
        <div className="admin-pass-card-top">
          <div className="admin-pass-badge" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none">
              <rect
                x="3.5"
                y="6"
                width="17"
                height="12"
                rx="2.5"
                stroke="currentColor"
                strokeWidth="1.7"
              />
              <path
                d="M3.5 10h17"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
              />
              <path
                d="M8 14h3.5"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
              />
            </svg>
          </div>
          <div className="admin-pass-copy">
            <h3 className="admin-pass-title">Manual Offline Pass</h3>
            <p className="admin-pass-lead">
              Activate after GCash or bank payment when Stripe checkout is unavailable.
            </p>
          </div>
        </div>

        <form className="admin-pass-form" onSubmit={handleActivate}>
          <label className="admin-field" htmlFor="activate-email">
            <span>Subscriber email</span>
            <input
              id="activate-email"
              name="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              placeholder="owner@venue.com"
            />
          </label>
          <label className="admin-field" htmlFor="activate-until">
            <span>Active until</span>
            <input
              id="activate-until"
              name="until"
              type="date"
              value={until}
              onChange={(e) => setUntil(e.target.value)}
              required
            />
          </label>
          <button type="submit" className="admin-action-btn admin-pass-submit" disabled={busy}>
            {busy ? 'Saving…' : 'Activate Pass'}
          </button>
        </form>
      </section>

      {error ? <p className="admin-inline-error">{error}</p> : null}

      {loading ? (
        <div className="admin-pass-loading" role="status">
          Loading subscribers…
        </div>
      ) : null}

      {!loading && !rows.length ? (
        <div className="admin-pass-empty">
          <div className="admin-pass-empty-mark" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <h3>No subscriber accounts yet</h3>
          <p>
            When a guest creates an Offline Pass account, they show up here. You can also
            activate by email above after a manual payment.
          </p>
        </div>
      ) : null}

      {rows.length ? (
        <>
          <div className="admin-pass-list" aria-label="Subscriber accounts">
            {rows.map((row) => {
              const accessOn = Boolean(row.offline_access)
              const untilLabel = row.manual_override_until
                ? `Manual · ${formatDate(row.manual_override_until)}`
                : row.current_period_end
                  ? formatDate(row.current_period_end)
                  : 'No end date'
              return (
                <article
                  key={row.id}
                  className={`admin-pass-row ${accessOn ? 'is-active' : 'is-inactive'}`}
                >
                  <div className="admin-pass-row-main">
                    <div className="admin-pass-row-avatar" aria-hidden="true">
                      {(row.email || '?').slice(0, 1).toUpperCase()}
                    </div>
                    <div className="admin-pass-row-body">
                      <h4>{row.email}</h4>
                      <p>{untilLabel}</p>
                    </div>
                  </div>
                  <div className="admin-pass-row-meta">
                    <span className={`admin-pass-pill ${accessOn ? 'on' : 'off'}`}>
                      {accessOn ? 'Access on' : 'No access'}
                    </span>
                    <span className="admin-pass-status">{row.status || 'inactive'}</span>
                    <button
                      type="button"
                      className="admin-action-btn ghost admin-pass-extend"
                      disabled={busy}
                      onClick={() => activateRow(row)}
                    >
                      Extend
                    </button>
                  </div>
                </article>
              )
            })}
          </div>

          <div className="admin-table-wrap admin-pass-table-desktop">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Status</th>
                  <th>Access</th>
                  <th>Period / Override</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={`table-${row.id}`}>
                    <td>{row.email}</td>
                    <td>{row.status}</td>
                    <td>{row.offline_access ? 'Yes' : 'No'}</td>
                    <td>
                      {row.manual_override_until
                        ? `Manual → ${formatDate(row.manual_override_until)}`
                        : row.current_period_end
                          ? formatDate(row.current_period_end)
                          : '—'}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="admin-nav-btn"
                        disabled={busy}
                        onClick={() => activateRow(row)}
                      >
                        Extend
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </div>
  )
}
