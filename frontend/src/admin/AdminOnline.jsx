import { useEffect, useState } from 'react'
import { listOnlinePresence } from '../api'

function formatAgo(seconds) {
  if (seconds < 15) return 'Just now'
  if (seconds < 60) return `${seconds}s ago`
  return `${Math.floor(seconds / 60)}m ago`
}

function pathLabel(path) {
  if (!path) return 'Songbook'
  if (path.includes('admin')) return 'Admin'
  return 'Songbook'
}

export default function AdminOnline() {
  const [data, setData] = useState({ count: 0, admin_count: 0, guest_count: 0, results: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = async () => {
    try {
      const next = await listOnlinePresence()
      setData(next)
      setError('')
    } catch (err) {
      setError(err.message || 'Could not load online users.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    const timer = window.setInterval(load, 8000)
    return () => window.clearInterval(timer)
  }, [])

  return (
    <div className="admin-panel">
      <div className="admin-panel-head">
        <div>
          <h2 className="admin-panel-title">Online now</h2>
          <p className="admin-panel-sub">People currently using the songbook or admin.</p>
        </div>
        <div className="admin-count-chip" aria-live="polite">
          <span className="admin-count-value">{data.count}</span>
          <span className="admin-count-label">online</span>
        </div>
      </div>

      <div className="admin-online-stats">
        <div className="admin-online-stat">
          <strong>{data.guest_count}</strong>
          <span>Guests</span>
        </div>
        <div className="admin-online-stat">
          <strong>{data.admin_count}</strong>
          <span>Admins</span>
        </div>
      </div>

      {error ? <p className="admin-inline-error">{error}</p> : null}

      <div className="admin-online-list">
        {data.results.map((person) => (
          <article key={person.id} className="admin-online-row">
            <span className={`admin-online-dot ${person.role === 'admin' ? 'admin' : 'guest'}`} />
            <div className="admin-online-body">
              <h3>
                {person.display_name}
                {person.role === 'admin' ? (
                  <span className="admin-song-tag">Admin</span>
                ) : (
                  <span className="admin-song-tag muted">Guest</span>
                )}
              </h3>
              <p>
                {pathLabel(person.path)} · {person.device} · {formatAgo(person.seconds_ago)}
              </p>
            </div>
          </article>
        ))}

        {!loading && !data.results.length ? (
          <div className="admin-empty-state">
            <p>No one else is online right now.</p>
          </div>
        ) : null}
      </div>

      {loading ? <p className="admin-meta loading">Checking presence…</p> : null}
      <p className="admin-meta">Updates every few seconds. Guests stay anonymous.</p>
    </div>
  )
}
