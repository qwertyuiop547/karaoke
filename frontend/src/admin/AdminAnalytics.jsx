import { useEffect, useState } from 'react'
import { fetchAnalyticsSummary } from '../api'

function formatRefreshWhen(iso) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
  } catch {
    return iso.slice(0, 16).replace('T', ' ')
  }
}

function sourceLabel(source) {
  if (source === 'csv_upload') return 'CSV upload'
  if (source === 'seed_command') return 'Seed command'
  return source || 'Refresh'
}

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

  const refresh = data?.catalog_refresh?.latest
  const recentRefreshes = data?.catalog_refresh?.recent || []
  const hasRefreshActivity =
    refresh &&
    (refresh.songs_created > 0 ||
      refresh.songs_updated > 0 ||
      refresh.songs_deleted > 0)

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
          {refresh ? (
            <div
              className={`admin-catalog-refresh-banner ${hasRefreshActivity ? 'has-changes' : ''}`}
              role="status"
            >
              <div>
                <strong>Catalog refresh</strong>
                <span>
                  {sourceLabel(refresh.source)} · {formatRefreshWhen(refresh.created_at)}
                  {refresh.note ? ` · ${refresh.note}` : ''}
                </span>
              </div>
              <div className="admin-catalog-refresh-stats">
                <span>
                  <em>+{refresh.songs_created || 0}</em> new
                </span>
                <span>
                  <em>~{refresh.songs_updated || 0}</em> updated
                </span>
                {refresh.songs_deleted ? (
                  <span>
                    <em>-{refresh.songs_deleted}</em> deleted
                  </span>
                ) : null}
                <span>
                  <em>{refresh.songs_total?.toLocaleString?.() ?? refresh.songs_total}</em> total
                </span>
              </div>
            </div>
          ) : (
            <div className="admin-catalog-refresh-banner is-empty" role="status">
              <div>
                <strong>No catalog refresh logged yet</strong>
                <span>Run seed_songs or upload CSV to track changes here.</span>
              </div>
            </div>
          )}

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

            {recentRefreshes.length > 0 ? (
              <section className="admin-analytics-card admin-analytics-card-wide">
                <h3>Recent catalog refreshes</h3>
                <ul className="admin-refresh-log">
                  {recentRefreshes.map((row) => (
                    <li key={row.id}>
                      <span>
                        {sourceLabel(row.source)} · {formatRefreshWhen(row.created_at)}
                        {row.note ? ` · ${row.note}` : ''}
                      </span>
                      <strong>
                        +{row.songs_created} · ~{row.songs_updated}
                        {row.songs_deleted ? ` · -${row.songs_deleted}` : ''}
                      </strong>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  )
}
