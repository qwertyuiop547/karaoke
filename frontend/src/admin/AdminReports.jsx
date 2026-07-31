import { useEffect, useState } from 'react'
import { listReports, resolveReport } from '../api'

const STATUS_FILTERS = ['all', 'open', 'reviewed', 'fixed', 'rejected']

const ACTIONS = [
  { id: 'update_number', label: 'Update number', needsFields: true },
  { id: 'delete_and_add', label: 'Delete wrong + add correct', needsFields: true },
  { id: 'add_correct', label: 'Add / update correct song', needsFields: true },
  { id: 'delete_wrong', label: 'Delete wrong song only', needsFields: false },
  { id: 'reviewed', label: 'Mark reviewed', needsFields: false },
  { id: 'reject', label: 'Reject report', needsFields: false },
]

export default function AdminReports({ onToast }) {
  const [status, setStatus] = useState('open')
  const [search, setSearch] = useState('')
  const [reports, setReports] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState(null)
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({
    action: 'update_number',
    admin_notes: '',
    correct_number: '',
    title: '',
    artist: '',
    language: '',
    genre: '',
  })

  const load = async (nextPage = 1, append = false) => {
    setLoading(true)
    setError('')
    try {
      const data = await listReports({
        status,
        search,
        page: nextPage,
        pageSize: 30,
      })
      const results = data.results || []
      setReports((prev) => (append ? [...prev, ...results] : results))
      setTotal(data.count || 0)
      setPage(nextPage)
      setHasMore(Boolean(data.next))
    } catch (err) {
      setError(err.message || 'Could not load reports.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const t = setTimeout(() => load(1, false), 250)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, search])

  const openResolve = (report) => {
    const song = report.song_detail
    setSelected(report)
    setForm({
      action: 'update_number',
      admin_notes: report.admin_notes || '',
      correct_number: report.suggested_number || report.platinum_number || '',
      title: (song?.title || report.title || '').trim(),
      artist: (song?.artist || report.artist || '').trim(),
      language: song?.language || '',
      genre: song?.genre || '',
    })
  }

  const needsFields = ACTIONS.find((a) => a.id === form.action)?.needsFields

  const handleResolve = async (e) => {
    e.preventDefault()
    if (!selected) return
    setBusy(true)
    try {
      const result = await resolveReport(selected.id, form)
      onToast?.(result.message || 'Report updated.')
      setSelected(null)
      await load(1, false)
    } catch (err) {
      onToast?.(err.message || 'Resolve failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="admin-panel">
      <div className="admin-panel-toolbar">
        <div className="admin-search-wrap">
          <input
            id="admin-reports-search"
            name="reports_search"
            className="admin-search-input"
            type="search"
            placeholder="Search reports…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="admin-status-pills">
          {STATUS_FILTERS.map((s) => (
            <button
              key={s}
              type="button"
              className={`cat-pill ${status === s ? 'active' : ''}`}
              onClick={() => setStatus(s)}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <p className="admin-meta">{total.toLocaleString()} reports</p>
      {error ? <p className="admin-inline-error">{error}</p> : null}

      <div className="admin-report-list">
        {reports.map((report) => (
          <article key={report.id} className="admin-report-card">
            <div className="admin-report-top">
              <span className={`admin-status-badge ${report.status}`}>{report.status}</span>
              <span className="admin-num">{report.platinum_number}</span>
            </div>
            <h3>{report.title || 'Untitled'}</h3>
            <p className="admin-report-artist">{report.artist || 'Unknown artist'}</p>
            {report.suggested_number ? (
              <p className="admin-report-suggest">Suggested: {report.suggested_number}</p>
            ) : null}
            {report.note ? <p className="admin-report-note">{report.note}</p> : null}
            <button type="button" className="admin-action-btn" onClick={() => openResolve(report)}>
              Resolve / Fix
            </button>
          </article>
        ))}
        {!loading && !reports.length ? (
          <p className="admin-empty-cell">No reports in this filter.</p>
        ) : null}
      </div>

      {loading ? <p className="admin-meta">Loading…</p> : null}

      {hasMore ? (
        <button
          type="button"
          className="admin-action-btn ghost wide"
          disabled={loading}
          onClick={() => load(page + 1, true)}
        >
          Load more
        </button>
      ) : null}

      {selected ? (
        <div className="drawer-overlay" onClick={() => setSelected(null)}>
          <div className="modal-card admin-form-modal" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-header">
              <div>
                <h2>Resolve #{selected.id}</h2>
                <p>
                  {selected.platinum_number} — {selected.title || 'Untitled'}
                </p>
              </div>
              <button type="button" className="close-drawer-btn" onClick={() => setSelected(null)}>
                X
              </button>
            </div>
            <form className="report-form" onSubmit={handleResolve}>
              <label>
                Action
                <select
                  value={form.action}
                  onChange={(e) => setForm((f) => ({ ...f, action: e.target.value }))}
                >
                  {ACTIONS.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.label}
                    </option>
                  ))}
                </select>
              </label>

              {needsFields ? (
                <>
                  <label>
                    Correct Platinum number
                    <input
                      value={form.correct_number}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, correct_number: e.target.value }))
                      }
                      required={form.action !== 'delete_wrong'}
                    />
                  </label>
                  <label>
                    Title
                    <input
                      value={form.title}
                      onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                      required={
                        form.action === 'delete_and_add' || form.action === 'add_correct'
                      }
                    />
                  </label>
                  <label>
                    Artist
                    <input
                      value={form.artist}
                      onChange={(e) => setForm((f) => ({ ...f, artist: e.target.value }))}
                    />
                  </label>
                  <label>
                    Language
                    <input
                      value={form.language}
                      onChange={(e) => setForm((f) => ({ ...f, language: e.target.value }))}
                    />
                  </label>
                  <label>
                    Genre
                    <input
                      value={form.genre}
                      onChange={(e) => setForm((f) => ({ ...f, genre: e.target.value }))}
                    />
                  </label>
                </>
              ) : null}

              <label>
                Admin notes
                <textarea
                  rows={3}
                  value={form.admin_notes}
                  onChange={(e) => setForm((f) => ({ ...f, admin_notes: e.target.value }))}
                />
              </label>

              <button type="submit" className="admin-action-btn wide" disabled={busy}>
                {busy ? 'Working…' : 'Apply action'}
              </button>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  )
}
