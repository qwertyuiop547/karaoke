import { useEffect, useState } from 'react'
import { fetchAnalyticsSummary } from '../api'

export default function AdminAnalytics() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const next = await fetchAnalyticsSummary()
        if (!cancelled) {
          setData(next)
          setError('')
        }
      } catch (err) {
        if (!cancelled) setError(err.message || 'Could not load analytics.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    const timer = window.setInterval(load, 30000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [])

  return (
    <div className="admin-panel">
      <div className="admin-panel-head">
        <div>
          <h2 className="admin-panel-title">Insights</h2>
          <p className="admin-panel-sub">
            Last {data?.window_days || 30} days of searches and reports.
          </p>
        </div>
      </div>

      {error ? <p className="admin-inline-error">{error}</p> : null}
      {loading && !data ? <p className="admin-meta loading">Loading insights…</p> : null}

      {data ? (
        <>
          <div className="admin-online-stats admin-analytics-stats">
            <div className="admin-online-stat">
              <strong>{data.song_count?.toLocaleString?.() ?? data.song_count}</strong>
              <span>Songs</span>
            </div>
            <div className="admin-online-stat">
              <strong>{data.search_count?.toLocaleString?.() ?? data.search_count}</strong>
              <span>Searches</span>
            </div>
            <div className="admin-online-stat">
              <strong>{data.open_reports}</strong>
              <span>Open reports</span>
            </div>
            <div className="admin-online-stat">
              <strong>{data.report_count}</strong>
              <span>All reports</span>
            </div>
          </div>

          <div className="admin-analytics-grid">
            <section className="admin-analytics-card">
              <h3>Top searches</h3>
              <ul>
                {(data.top_searches || []).map((row) => (
                  <li key={row.query}>
                    <span>{row.query}</span>
                    <strong>{row.hits}</strong>
                  </li>
                ))}
                {!data.top_searches?.length ? <li className="muted">No searches yet.</li> : null}
              </ul>
            </section>

            <section className="admin-analytics-card">
              <h3>Most reported</h3>
              <ul>
                {(data.top_reported || []).map((row) => (
                  <li key={`${row.platinum_number}-${row.title}`}>
                    <span>
                      <em>{row.platinum_number}</em> {row.title || 'Untitled'}
                      {row.artist ? ` — ${row.artist}` : ''}
                    </span>
                    <strong>{row.hits}</strong>
                  </li>
                ))}
                {!data.top_reported?.length ? <li className="muted">No reports yet.</li> : null}
              </ul>
            </section>
          </div>
        </>
      ) : null}
    </div>
  )
}
