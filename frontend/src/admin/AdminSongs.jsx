import { useEffect, useState } from 'react'
import {
  searchSongs,
  createSong,
  updateSong,
  deleteSong,
  uploadSongsCsv,
} from '../api'

const EMPTY_FORM = {
  platinum_number: '',
  title: '',
  artist: '',
  language: '',
  genre: '',
}

export default function AdminSongs({ onToast }) {
  const [query, setQuery] = useState('')
  const [songs, setSongs] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [form, setForm] = useState(EMPTY_FORM)
  const [editingId, setEditingId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [pendingDelete, setPendingDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)

  const load = async (nextPage = 1, append = false) => {
    setLoading(true)
    setError('')
    try {
      const data = await searchSongs(query, { page: nextPage, pageSize: 40 })
      const results = data.results || []
      setSongs((prev) => (append ? [...prev, ...results] : results))
      setTotal(data.count || 0)
      setPage(nextPage)
      setHasMore(Boolean(data.next))
    } catch (err) {
      setError(err.message || 'Could not load songs.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const t = setTimeout(() => load(1, false), 250)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  const openCreate = () => {
    setEditingId(null)
    setForm(EMPTY_FORM)
    setShowForm(true)
  }

  const openEdit = (song) => {
    setEditingId(song.id)
    setForm({
      platinum_number: song.platinum_number || '',
      title: song.title || '',
      artist: song.artist || '',
      language: song.language || '',
      genre: song.genre || '',
    })
    setShowForm(true)
  }

  const handleSave = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      const payload = {
        platinum_number: form.platinum_number.trim(),
        title: form.title.trim(),
        artist: form.artist.trim(),
        language: form.language.trim(),
        genre: form.genre.trim(),
      }
      if (editingId) {
        await updateSong(editingId, payload)
        onToast?.('Song updated.')
      } else {
        await createSong(payload)
        onToast?.('Song created.')
      }
      setShowForm(false)
      await load(1, false)
    } catch (err) {
      onToast?.(err.message || 'Save failed.')
    } finally {
      setSaving(false)
    }
  }

  const askDelete = (song) => {
    setPendingDelete(song)
  }

  const cancelDelete = () => {
    if (deleting) return
    setPendingDelete(null)
  }

  const confirmDelete = async () => {
    if (!pendingDelete) return
    const snapshot = {
      platinum_number: pendingDelete.platinum_number || '',
      title: pendingDelete.title || '',
      artist: pendingDelete.artist || '',
      language: pendingDelete.language || '',
      genre: pendingDelete.genre || '',
    }
    setDeleting(true)
    try {
      await deleteSong(pendingDelete.id)
      setPendingDelete(null)
      await load(page, false)
      onToast?.({
        message: `Deleted ${snapshot.platinum_number} — ${snapshot.title}`,
        undo: async () => {
          await createSong(snapshot)
          onToast?.('Song restored.')
          await load(1, false)
        },
      })
    } catch (err) {
      onToast?.(err.message || 'Delete failed.')
    } finally {
      setDeleting(false)
    }
  }

  const handleCsv = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setUploading(true)
    try {
      const result = await uploadSongsCsv(file)
      onToast?.(result.message || 'CSV uploaded.')
      await load(1, false)
    } catch (err) {
      onToast?.(err.message || 'CSV upload failed.')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="admin-panel">
      <div className="admin-panel-head">
        <div>
          <h2 className="admin-panel-title">Catalog</h2>
          <p className="admin-panel-sub">Search, edit, or bulk-upload Platinum numbers.</p>
        </div>
        <div className="admin-count-chip" aria-live="polite">
          <span className="admin-count-value">{total.toLocaleString()}</span>
          <span className="admin-count-label">songs</span>
        </div>
      </div>

      <div className="admin-panel-toolbar">
        <div className="admin-search-wrap">
          <svg className="admin-search-icon" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.8" fill="none" />
            <path d="M20 20l-3.5-3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          <input
            id="admin-songs-search"
            name="songs_search"
            className="admin-search-input"
            type="search"
            placeholder="Search number, title, or artist…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="admin-toolbar-actions">
          <button type="button" className="admin-action-btn" onClick={openCreate}>
            + Add song
          </button>
          <label className={`admin-action-btn ghost ${uploading ? 'disabled' : ''}`}>
            {uploading ? 'Uploading…' : 'Upload CSV'}
            <input
              type="file"
              accept=".csv,text/csv"
              hidden
              disabled={uploading}
              onChange={handleCsv}
            />
          </label>
        </div>
      </div>

      {error ? <p className="admin-inline-error">{error}</p> : null}

      <div className="admin-song-list" aria-busy={loading}>
        {songs.map((song) => (
          <article key={song.id} className="admin-song-row">
            <div className="admin-song-code">
              <span className="admin-song-code-label">Platinum</span>
              <span className="admin-song-code-num">{song.platinum_number}</span>
            </div>
            <div className="admin-song-body">
              <h3 className="admin-song-title">{song.title}</h3>
              <p className="admin-song-meta">
                <span>{song.artist || 'Unknown artist'}</span>
                {song.language ? <span className="admin-song-tag">{song.language}</span> : null}
                {song.genre ? <span className="admin-song-tag muted">{song.genre}</span> : null}
              </p>
            </div>
            <div className="admin-row-actions">
              <button type="button" className="mini-btn" onClick={() => openEdit(song)}>
                Edit
              </button>
              <button
                type="button"
                className="mini-btn danger"
                onClick={() => askDelete(song)}
              >
                Delete
              </button>
            </div>
          </article>
        ))}

        {!loading && !songs.length ? (
          <div className="admin-empty-state">
            <p>No songs match this search.</p>
          </div>
        ) : null}
      </div>

      {loading ? <p className="admin-meta loading">Loading catalog…</p> : null}

      {hasMore ? (
        <button
          type="button"
          className="admin-action-btn ghost wide"
          disabled={loading}
          onClick={() => load(page + 1, true)}
        >
          Load more songs
        </button>
      ) : null}

      {showForm ? (
        <div className="drawer-overlay" onClick={() => setShowForm(false)}>
          <div className="modal-card admin-form-modal" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-header">
              <div>
                <h2>{editingId ? 'Edit song' : 'Add song'}</h2>
                <p>Platinum number must be unique.</p>
              </div>
              <button type="button" className="close-drawer-btn" onClick={() => setShowForm(false)}>
                X
              </button>
            </div>
            <form className="report-form" onSubmit={handleSave}>
              <label>
                Platinum number
                <input
                  required
                  value={form.platinum_number}
                  onChange={(e) => setForm((f) => ({ ...f, platinum_number: e.target.value }))}
                />
              </label>
              <label>
                Title
                <input
                  required
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                />
              </label>
              <label>
                Artist
                <input
                  value={form.artist}
                  onChange={(e) => setForm((f) => ({ ...f, artist: e.target.value }))}
                />
              </label>
              <div className="admin-form-grid">
                <label>
                  Language
                  <input
                    value={form.language}
                    onChange={(e) => setForm((f) => ({ ...f, language: e.target.value }))}
                    placeholder="English / Filipino"
                  />
                </label>
                <label>
                  Genre
                  <input
                    value={form.genre}
                    onChange={(e) => setForm((f) => ({ ...f, genre: e.target.value }))}
                  />
                </label>
              </div>
              <button type="submit" className="admin-action-btn wide" disabled={saving}>
                {saving ? 'Saving…' : 'Save song'}
              </button>
            </form>
          </div>
        </div>
      ) : null}

      {pendingDelete ? (
        <div className="drawer-overlay" onClick={cancelDelete}>
          <div
            className="modal-card admin-form-modal admin-confirm-modal"
            onClick={(e) => e.stopPropagation()}
            role="alertdialog"
            aria-labelledby="delete-song-title"
            aria-describedby="delete-song-desc"
          >
            <div className="drawer-header">
              <div>
                <h2 id="delete-song-title">Delete this song?</h2>
                <p id="delete-song-desc">You can undo this within 5 seconds after deleting.</p>
              </div>
              <button type="button" className="close-drawer-btn" onClick={cancelDelete}>
                X
              </button>
            </div>
            <div className="admin-confirm-body">
              <div className="admin-confirm-song">
                <span className="admin-num">{pendingDelete.platinum_number}</span>
                <div>
                  <strong>{pendingDelete.title}</strong>
                  <small>{pendingDelete.artist || 'Unknown artist'}</small>
                </div>
              </div>
              <div className="admin-confirm-actions">
                <button
                  type="button"
                  className="admin-action-btn ghost"
                  onClick={cancelDelete}
                  disabled={deleting}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="admin-action-btn danger-solid"
                  onClick={confirmDelete}
                  disabled={deleting}
                >
                  {deleting ? 'Deleting…' : 'Yes, delete'}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
