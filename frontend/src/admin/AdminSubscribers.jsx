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

  return (
    <div className="admin-subscribers">
      <section className="admin-subscribers-grant">
        <h2 className="admin-section-title">Manual Offline Pass</h2>
        <p className="admin-section-lead">
          Activate after GCash / bank payment when Stripe is unavailable.
        </p>
        <form className="admin-subscribers-form" onSubmit={handleActivate}>
          <label className="admin-field">
            <span>Subscriber email</span>
            <input
              id="activate-email"
              name="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="owner@venue.com"
            />
          </label>
          <label className="admin-field">
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
          <button type="submit" className="admin-action-btn" disabled={busy}>
            {busy ? 'Saving…' : 'Activate'}
          </button>
        </form>
      </section>

      {error ? <p className="admin-inline-error">{error}</p> : null}
      {loading ? <p className="admin-checking">Loading subscribers…</p> : null}

      {!loading && !rows.length ? (
        <p className="admin-empty">No subscriber accounts yet.</p>
      ) : null}

      {rows.length ? (
        <div className="admin-table-wrap">
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
                <tr key={row.id}>
                  <td>{row.email}</td>
                  <td>{row.status}</td>
                  <td>{row.offline_access ? 'Yes' : 'No'}</td>
                  <td>
                    {row.manual_override_until
                      ? `Manual → ${row.manual_override_until.slice(0, 10)}`
                      : row.current_period_end
                        ? row.current_period_end.slice(0, 10)
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
      ) : null}
    </div>
  )
}
