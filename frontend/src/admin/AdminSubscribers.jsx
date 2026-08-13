import {
  adminActivateSubscriber,
  adminModerateSubscriber,
  deleteReferralCampaign,
  fetchReferralCampaigns,
  listSubscribers,
  saveReferralCampaign,
} from '../api'
import { useEffect, useMemo, useState } from 'react'

function defaultUntil() {
  const d = new Date()
  d.setMonth(d.getMonth() + 1)
  return d.toISOString().slice(0, 10)
}

function formatDate(value) {
  if (!value) return '—'
  return value.slice(0, 10)
}

function periodLabel(row) {
  if (row.manual_override_until) {
    return `Manual · ${formatDate(row.manual_override_until)}`
  }
  if (row.current_period_end) {
    return `Until ${formatDate(row.current_period_end)}`
  }
  return 'No end date'
}

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'active', label: 'Active' },
  { id: 'inactive', label: 'Inactive' },
  { id: 'banned', label: 'Banned' },
]

export default function AdminSubscribers({ onToast }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [email, setEmail] = useState('')
  const [until, setUntil] = useState(defaultUntil)
  const [busy, setBusy] = useState(false)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [openMenuId, setOpenMenuId] = useState(null)

  const [campaigns, setCampaigns] = useState([])
  const [campCode, setCampCode] = useState('')
  const [campTitle, setCampTitle] = useState('')
  const [campDays, setCampDays] = useState(3)
  const [campMax, setCampMax] = useState(50)
  const [campUntil, setCampUntil] = useState('')
  const [campActive, setCampActive] = useState(true)

  const refreshCampaigns = async () => {
    try {
      const data = await fetchReferralCampaigns()
      setCampaigns(data.results || [])
    } catch {
      setCampaigns([])
    }
  }

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
    refreshCampaigns()
  }, [])

  const handleSaveCampaign = async (e) => {
    e.preventDefault()
    if (!campCode.trim()) return
    setBusy(true)
    try {
      const res = await saveReferralCampaign({
        code: campCode.trim(),
        title: campTitle.trim(),
        bonus_days: parseInt(campDays, 10) || 3,
        max_redeems: parseInt(campMax, 10) || 0,
        valid_until: campUntil ? new Date(campUntil).toISOString() : null,
        is_active: campActive,
      })
      onToast?.(res.message || 'Campaign saved!')
      setCampCode('')
      setCampTitle('')
      setCampDays(3)
      setCampMax(50)
      setCampUntil('')
      await refreshCampaigns()
    } catch (err) {
      onToast?.(err.message || 'Could not save campaign.')
    } finally {
      setBusy(false)
    }
  }

  const handleToggleCampaign = async (item) => {
    setBusy(true)
    try {
      await saveReferralCampaign({
        code: item.code,
        title: item.title,
        bonus_days: item.bonus_days,
        max_redeems: item.max_redeems,
        valid_until: item.valid_until,
        is_active: !item.is_active,
      })
      onToast?.(`Toggled ${item.code} -> ${!item.is_active ? 'Active' : 'Inactive'}`)
      await refreshCampaigns()
    } catch (err) {
      onToast?.(err.message || 'Toggle failed.')
    } finally {
      setBusy(false)
    }
  }

  const handleDeleteCampaign = async (item) => {
    if (!window.confirm(`Delete promo code ${item.code}?`)) return
    setBusy(true)
    try {
      await deleteReferralCampaign(item.id)
      onToast?.(`Deleted promo code ${item.code}`)
      await refreshCampaigns()
    } catch (err) {
      onToast?.(err.message || 'Delete failed.')
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (!openMenuId) return undefined
    const close = () => setOpenMenuId(null)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [openMenuId])

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
    setOpenMenuId(null)
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

  const moderateRow = async (row, action) => {
    setBusy(true)
    setOpenMenuId(null)
    try {
      await adminModerateSubscriber({ userId: row.user_id, action })
      onToast?.(`${action} · ${row.email}`)
      await refresh()
    } catch (err) {
      onToast?.(err.message || 'Action failed.')
    } finally {
      setBusy(false)
    }
  }

  const activeCount = rows.filter((row) => row.offline_access).length
  const bannedCount = rows.filter((row) => row.is_banned).length
  const inactiveCount = rows.length - activeCount

  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return rows.filter((row) => {
      if (filter === 'active' && !row.offline_access) return false
      if (filter === 'inactive' && row.offline_access) return false
      if (filter === 'banned' && !row.is_banned) return false
      if (!q) return true
      return String(row.email || '')
        .toLowerCase()
        .includes(q)
    })
  }, [rows, query, filter])

  return (
    <div className="admin-subscribers">
      <header className="admin-panel-head">
        <div>
          <h2 className="admin-panel-title">Subscribers</h2>
          <p className="admin-panel-sub">
            Offline Pass · activate after GCash / bank payment
          </p>
        </div>
      </header>

      <div className="admin-sub-stats" aria-label="Subscriber totals">
        <div className="admin-sub-stat">
          <strong>{loading ? '—' : rows.length}</strong>
          <span>Total</span>
        </div>
        <div className="admin-sub-stat is-live">
          <strong>{loading ? '—' : activeCount}</strong>
          <span>Active</span>
        </div>
        <div className="admin-sub-stat">
          <strong>{loading ? '—' : inactiveCount}</strong>
          <span>Inactive</span>
        </div>
        <div className="admin-sub-stat is-warn">
          <strong>{loading ? '—' : bannedCount}</strong>
          <span>Banned</span>
        </div>
      </div>

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
            <h3 className="admin-pass-title">Activate Offline Pass</h3>
            <p className="admin-pass-lead">
              After payment, enter the subscriber email. QR note must be:{' '}
              <em>Karaoke Pass</em>.
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
          <button
            type="submit"
            className="admin-action-btn admin-pass-submit"
            disabled={busy}
          >
            {busy ? 'Saving…' : 'Activate Pass'}
          </button>
        </form>
      </section>

      <section className="admin-pass-card admin-referral-campaigns-card">
        <div className="admin-pass-card-top">
          <div className="admin-pass-badge" aria-hidden="true">🎁</div>
          <div className="admin-pass-copy">
            <h3 className="admin-pass-title">Referral & Promo Campaigns</h3>
            <p className="admin-pass-lead">
              Set bonus days, max redeem count limits, and expiration dates for promo codes.
            </p>
          </div>
        </div>

        <form className="admin-pass-form admin-campaign-form" onSubmit={handleSaveCampaign}>
          <label className="admin-field">
            <span>Promo Code</span>
            <input
              type="text"
              value={campCode}
              onChange={(e) => setCampCode(e.target.value)}
              placeholder="e.g. WELCOME50"
              required
            />
          </label>
          <label className="admin-field">
            <span>Bonus Days</span>
            <input
              type="number"
              min="1"
              max="365"
              value={campDays}
              onChange={(e) => setCampDays(e.target.value)}
              required
            />
          </label>
          <label className="admin-field">
            <span>Max Redeems (0 = ∞)</span>
            <input
              type="number"
              min="0"
              value={campMax}
              onChange={(e) => setCampMax(e.target.value)}
            />
          </label>
          <label className="admin-field">
            <span>Expiration Date (Optional)</span>
            <input
              type="date"
              value={campUntil}
              onChange={(e) => setCampUntil(e.target.value)}
            />
          </label>
          <button type="submit" className="admin-action-btn admin-pass-submit" disabled={busy}>
            {busy ? 'Saving…' : 'Save Campaign Code'}
          </button>
        </form>

        {campaigns.length ? (
          <div className="admin-campaign-list">
            <h4>Active & Managed Campaigns ({campaigns.length})</h4>
            <div className="admin-campaign-grid">
              {campaigns.map((c) => (
                <div key={c.id} className={`admin-campaign-item ${!c.is_active ? 'inactive' : ''}`}>
                  <div className="admin-campaign-head">
                    <strong>{c.code}</strong>
                    <span className={`admin-campaign-pill ${c.is_valid ? 'valid' : 'invalid'}`}>
                      {c.is_valid ? 'Active' : c.status_reason}
                    </span>
                  </div>
                  <div className="admin-campaign-body">
                    <p>🎁 <strong>+{c.bonus_days} days</strong> bonus trial</p>
                    <p>👥 Redeems: <strong>{c.redeem_count} / {c.max_redeems || '∞'}</strong></p>
                    <p>📅 Valid until: {c.valid_until ? formatDate(c.valid_until) : 'No expiry'}</p>
                  </div>
                  <div className="admin-campaign-actions">
                    <button
                      type="button"
                      className="admin-action-btn ghost"
                      onClick={() => handleToggleCampaign(c)}
                      disabled={busy}
                    >
                      {c.is_active ? 'Disable' : 'Enable'}
                    </button>
                    <button
                      type="button"
                      className="admin-action-btn danger"
                      onClick={() => handleDeleteCampaign(c)}
                      disabled={busy}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </section>

      <div className="admin-sub-toolbar">
        <div className="admin-search-wrap">
          <svg
            className="admin-search-icon"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.8" />
            <path
              d="M16.2 16.2L20 20"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
          <input
            className="admin-search-input"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by email…"
            aria-label="Search subscribers"
          />
        </div>
        <div className="admin-sub-filters" role="tablist" aria-label="Filter subscribers">
          {FILTERS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={filter === item.id}
              className={`admin-sub-filter ${filter === item.id ? 'active' : ''}`}
              onClick={() => setFilter(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

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
            When a guest creates an Offline Pass account, they show up here. You
            can also activate by email above after a manual payment.
          </p>
        </div>
      ) : null}

      {!loading && rows.length && !filteredRows.length ? (
        <div className="admin-pass-empty admin-sub-empty-filter">
          <h3>No matches</h3>
          <p>Try another email or clear the filter.</p>
        </div>
      ) : null}

      {filteredRows.length ? (
        <div className="admin-sub-list" aria-label="Subscriber accounts">
          {filteredRows.map((row) => {
            const accessOn = Boolean(row.offline_access)
            const menuOpen = openMenuId === row.id
            return (
              <article
                key={row.id}
                className={`admin-sub-card ${accessOn ? 'is-active' : 'is-inactive'} ${
                  row.is_banned ? 'is-banned' : ''
                }`}
              >
                <div className="admin-sub-card-main">
                  <div className="admin-sub-avatar" aria-hidden="true">
                    {(row.email || '?').slice(0, 1).toUpperCase()}
                  </div>
                  <div className="admin-sub-body">
                    <div className="admin-sub-email-row">
                      <h4>{row.email}</h4>
                      <div className="admin-sub-badges">
                        <span
                          className={`admin-pass-pill ${accessOn ? 'on' : 'off'}`}
                        >
                          {accessOn ? 'Access on' : 'No access'}
                        </span>
                        {row.is_banned ? (
                          <span className="admin-sub-chip danger">Banned</span>
                        ) : null}
                        {!row.email_verified ? (
                          <span className="admin-sub-chip warn">Unverified</span>
                        ) : null}
                        <span className="admin-sub-chip">{row.status || 'inactive'}</span>
                      </div>
                    </div>
                    <p className="admin-sub-period">{periodLabel(row)}</p>
                  </div>
                </div>

                <div className="admin-sub-actions">
                  <button
                    type="button"
                    className="admin-action-btn admin-sub-primary"
                    disabled={busy}
                    onClick={() => activateRow(row)}
                  >
                    Extend
                  </button>
                  <div className="admin-sub-more">
                    <button
                      type="button"
                      className="admin-action-btn ghost admin-sub-more-btn"
                      disabled={busy}
                      aria-expanded={menuOpen}
                      aria-haspopup="menu"
                      onClick={(e) => {
                        e.stopPropagation()
                        setOpenMenuId(menuOpen ? null : row.id)
                      }}
                    >
                      More
                    </button>
                    {menuOpen ? (
                      <div
                        className="admin-sub-menu"
                        role="menu"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {!row.email_verified ? (
                          <button
                            type="button"
                            role="menuitem"
                            disabled={busy}
                            onClick={() => moderateRow(row, 'verify_email')}
                          >
                            Verify email
                          </button>
                        ) : null}
                        <button
                          type="button"
                          role="menuitem"
                          disabled={busy}
                          onClick={() => moderateRow(row, 'grant_trial')}
                        >
                          Grant 3-day trial
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          disabled={busy}
                          onClick={() => moderateRow(row, 'revoke_trial')}
                        >
                          Revoke trial
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          className={row.is_banned ? '' : 'danger'}
                          disabled={busy}
                          onClick={() =>
                            moderateRow(row, row.is_banned ? 'unban' : 'ban')
                          }
                        >
                          {row.is_banned ? 'Unban account' : 'Ban account'}
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
