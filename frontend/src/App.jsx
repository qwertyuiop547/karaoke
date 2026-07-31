import { useEffect, useRef, useState } from 'react'
import gsap from 'gsap'
import { useGSAP } from '@gsap/react'
import AdminGate from './AdminGate'
import { searchSongs, fetchOfflinePack, reportWrongNumber, adminMe } from './api'
import { usePresencePing } from './usePresencePing'
import {
  getFavorites,
  toggleFavorite,
  removeFavorite,
  clearFavorites,
  isFavorite,
} from './favorites'
import {
  getOfflineMeta,
  saveOfflineCatalog,
  searchOfflineCatalog,
} from './offline'
import JoinQrModal from './JoinQrModal'
import InstallAppModal from './InstallAppModal'
import AccountModal from './AccountModal'
import { usePwaInstall } from './usePwaInstall'
import { useConnectivity } from './useConnectivity'
import { consumeJoinParam } from './joinUrl'
import './App.css'

gsap.registerPlugin(useGSAP)

function useDebouncedValue(value, delay = 280) {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])

  return debounced
}

const ALPHABET = ['ALL', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')]
const CATEGORIES = ['ALL', 'OPM', 'ENGLISH']
const PAGE_SIZE = 10

function getPageItems(current, totalPages) {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1)
  }
  const pages = new Set([1, totalPages, current, current - 1, current + 1])
  if (current <= 3) {
    pages.add(2)
    pages.add(3)
    pages.add(4)
  }
  if (current >= totalPages - 2) {
    pages.add(totalPages - 1)
    pages.add(totalPages - 2)
    pages.add(totalPages - 3)
  }
  const sorted = [...pages].filter((p) => p >= 1 && p <= totalPages).sort((a, b) => a - b)
  const items = []
  for (let i = 0; i < sorted.length; i += 1) {
    if (i > 0 && sorted[i] - sorted[i - 1] > 1) items.push('…')
    items.push(sorted[i])
  }
  return items
}

export default function App() {
  const [query, setQuery] = useState('')
  const [selectedLetter, setSelectedLetter] = useState('ALL')
  const [selectedCategory, setSelectedCategory] = useState('ALL')
  const [songs, setSongs] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [waking, setWaking] = useState(false)
  const [reloadToken, setReloadToken] = useState(0)
  const [error, setError] = useState('')
  const [usingOffline, setUsingOffline] = useState(false)
  const { online } = useConnectivity({ intervalMs: 60000, timeoutMs: 10000, failThreshold: 3 })
  const prevOnlineRef = useRef(online)

  const [favorites, setFavorites] = useState(() => getFavorites())
  const [showFavorites, setShowFavorites] = useState(false)

  const [offlineMeta, setOfflineMeta] = useState(() => getOfflineMeta())
  const [syncingOffline, setSyncingOffline] = useState(false)

  const [reportSong, setReportSong] = useState(null)
  const [reportNote, setReportNote] = useState('')
  const [reportSuggested, setReportSuggested] = useState('')
  const [reportBusy, setReportBusy] = useState(false)

  const [toast, setToast] = useState('')
  const [showJoinQr, setShowJoinQr] = useState(false)
  const [showInstallApp, setShowInstallApp] = useState(false)
  const [showAccount, setShowAccount] = useState(false)
  const [account, setAccount] = useState({ authenticated: false })
  const { installed: appInstalled, ios, canPromptInstall, promptInstall } = usePwaInstall()
  const [showAdminLogin, setShowAdminLogin] = useState(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('join') === '1') return false
    return window.location.hash === '#admin'
  })

  usePresencePing(showAdminLogin ? 'admin' : 'songbook')

  const hasOfflineAccess = Boolean(account?.offline_access)

  const containerRef = useRef(null)
  const listRef = useRef(null)
  const alphabetScrollRef = useRef(null)
  const prefersReducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  // Skip GSAP on phones — transform/stagger animations stutter on mid-range Android.
  const skipMotion =
    prefersReducedMotion ||
    (typeof window !== 'undefined' &&
      window.matchMedia('(pointer: coarse), (max-width: 820px)').matches)

  const debouncedQuery = useDebouncedValue(query)

  const showToast = (msg) => {
    setToast(msg)
    window.setTimeout(() => setToast(''), 2800)
  }

  useEffect(() => {
    if (consumeJoinParam()) {
      if (window.location.hash === '#admin') {
        window.history.replaceState(null, '', window.location.pathname + window.location.search)
      }
      setShowAdminLogin(false)
      showToast('Welcome! Search a title or artist to get the song number.')
    }

    const params = new URLSearchParams(window.location.search)
    const billing = params.get('billing')
    if (billing === 'success') {
      showToast('Payment received — Offline Pass activating. You can save the catalog now.')
      params.delete('billing')
      params.delete('session_id')
      const next = `${window.location.pathname}${params.toString() ? `?${params}` : ''}${window.location.hash}`
      window.history.replaceState(null, '', next)
      adminMe()
        .then((me) => {
          if (me?.authenticated) setAccount(me)
        })
        .catch(() => {})
      setShowAccount(true)
    } else if (billing === 'cancel') {
      showToast('Checkout canceled.')
      params.delete('billing')
      const next = `${window.location.pathname}${params.toString() ? `?${params}` : ''}${window.location.hash}`
      window.history.replaceState(null, '', next)
    }

    adminMe()
      .then((me) => {
        if (me?.authenticated) setAccount(me)
      })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Page refresh / first load entrance (songbook only)
  useGSAP(
    () => {
      const root = containerRef.current
      if (!root?.querySelector('.songbook-binder')) return

      const q = (sel) => root.querySelectorAll(sel)
      const has = (sel) => q(sel).length > 0

      // Always ensure interactive UI is visible (avoids stuck opacity:0 from interrupted tweens)
      gsap.set(
        q(
          '.search-section, .cat-pill, .alphabet-btn, .category-bar, .alphabet-bar, .directory-status',
        ),
        { clearProps: 'all', opacity: 1, y: 0, scale: 1 },
      )

      if (skipMotion) return

      const tl = gsap.timeline({
        defaults: { ease: 'power3.out' },
        onComplete: () => {
          if (!containerRef.current) return
          gsap.set(
            containerRef.current.querySelectorAll(
              '.songbook-binder, .ring, .songbook-header, .search-section, .cat-pill, .alphabet-btn, .directory-status, .toolbar-btn, .net-pill',
            ),
            { clearProps: 'transform,opacity' },
          )
        },
      })

      if (has('.songbook-binder')) {
        tl.fromTo(
          q('.songbook-binder'),
          { opacity: 0, y: 36, scale: 0.97 },
          { opacity: 1, y: 0, scale: 1, duration: 0.65 },
        )
      }
      if (has('.ring')) {
        tl.fromTo(
          q('.ring'),
          { opacity: 0, y: -14 },
          { opacity: 1, y: 0, stagger: 0.025, duration: 0.3 },
          '-=0.3',
        )
      }
      if (has('.header-badge')) {
        tl.fromTo(
          q('.header-badge'),
          { opacity: 0, y: -10 },
          { opacity: 1, y: 0, duration: 0.3 },
          '-=0.1',
        )
      }
      if (has('.songbook-title')) {
        tl.fromTo(
          q('.songbook-title'),
          { opacity: 0, y: 20 },
          { opacity: 1, y: 0, duration: 0.4 },
          '-=0.15',
        )
      }
      if (has('.songbook-subtitle, .source-note')) {
        tl.fromTo(
          q('.songbook-subtitle, .source-note'),
          { opacity: 0, y: 12 },
          { opacity: 1, y: 0, stagger: 0.06, duration: 0.3 },
          '-=0.15',
        )
      }
      if (has('.toolbar-btn, .net-pill')) {
        tl.fromTo(
          q('.toolbar-btn, .net-pill'),
          { opacity: 0, y: 8 },
          { opacity: 1, y: 0, stagger: 0.05, duration: 0.28 },
          '-=0.1',
        )
      }
      if (has('.search-section')) {
        tl.fromTo(
          q('.search-section'),
          { opacity: 0, y: 16 },
          { opacity: 1, y: 0, duration: 0.4 },
          '-=0.05',
        )
      }
      if (has('.directory-status')) {
        tl.fromTo(
          q('.directory-status'),
          { opacity: 0 },
          { opacity: 1, duration: 0.25 },
          '-=0.1',
        )
      }
    },
    { scope: containerRef, dependencies: [showAdminLogin, skipMotion] },
  )

  // Song rows animate when the page/results change
  useGSAP(
    () => {
      if (showAdminLogin || skipMotion || loading || !songs.length) return

      const rows = listRef.current?.querySelectorAll('.songbook-row')
      if (!rows?.length) return

      gsap.fromTo(
        rows,
        { autoAlpha: 0, y: 16 },
        {
          autoAlpha: 1,
          y: 0,
          duration: 0.35,
          stagger: 0.03,
          ease: 'power2.out',
          overwrite: true,
          clearProps: 'transform',
        },
      )
    },
    {
      scope: listRef,
      dependencies: [songs, loading, page, showAdminLogin, skipMotion],
    },
  )

  useEffect(() => {
    const onHash = () => setShowAdminLogin(window.location.hash === '#admin')
    window.addEventListener('hashchange', onHash)
    return () => {
      window.removeEventListener('hashchange', onHash)
    }
  }, [])

  // Detect online ↔ offline without refresh; surface Offline Pass when needed.
  useEffect(() => {
    const wasOnline = prevOnlineRef.current
    if (wasOnline === online) return
    prevOnlineRef.current = online

    if (!online) {
      const meta = getOfflineMeta()
      setOfflineMeta(meta)
      // Only push Offline Pass UI when the *device* reports no network.
      // Slow API alone should not spam the install modal.
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        if (meta?.count) {
          showToast(`Offline mode · ${meta.count.toLocaleString()} songs on this device`)
        } else {
          showToast('Offline — set up Offline Pass when you’re back online.')
          setShowInstallApp(true)
        }
      } else {
        showToast('Server unreachable — retrying…')
      }
    } else if (wasOnline === false) {
      showToast('Back online')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online])

  // Cold start already offline (installed PWA opened without network).
  useEffect(() => {
    if (online) return
    if (typeof navigator !== 'undefined' && navigator.onLine !== false) return
    const meta = getOfflineMeta()
    setOfflineMeta(meta)
    if (!meta?.count) {
      setShowInstallApp(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const root = alphabetScrollRef.current
    if (!root) return
    const active = root.querySelector('.alphabet-btn.active')
    active?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
  }, [selectedLetter])

  const openAdminLogin = () => {
    window.location.hash = 'admin'
    setShowAdminLogin(true)
  }

  const closeAdminLogin = () => {
    if (window.location.hash === '#admin') {
      window.history.replaceState(null, '', window.location.pathname)
    }
    setShowAdminLogin(false)
  }

  const filterKey = `${debouncedQuery}|${selectedLetter}|${selectedCategory}`
  const prevFilterKey = useRef(filterKey)

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE) || 1)
  const rangeStart = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1
  const rangeEnd = Math.min(page * PAGE_SIZE, total)

  useEffect(() => {
    if (page > totalPages) setPage(totalPages)
  }, [page, totalPages])

  useEffect(() => {
    // Reset to page 1 when filters change (avoid loading the old page first)
    if (prevFilterKey.current !== filterKey) {
      prevFilterKey.current = filterKey
      if (page !== 1) {
        setPage(1)
        return
      }
    }

    const controller = new AbortController()

    async function load() {
      setLoading(true)
      setWaking(false)
      setError('')
      try {
        let data
        if (!online) {
          data = await searchOfflineCatalog(debouncedQuery, {
            letter: selectedLetter,
            category: selectedCategory,
            page,
            pageSize: PAGE_SIZE,
          })
          setUsingOffline(true)
        } else {
          try {
            data = await searchSongs(debouncedQuery, {
              signal: controller.signal,
              letter: selectedLetter,
              category: selectedCategory,
              page,
              pageSize: PAGE_SIZE,
              onRetry: () => setWaking(true),
            })
            setUsingOffline(false)
            setWaking(false)
          } catch (err) {
            if (err.name === 'AbortError') return
            const meta = getOfflineMeta()
            if (meta?.count) {
              data = await searchOfflineCatalog(debouncedQuery, {
                letter: selectedLetter,
                category: selectedCategory,
                page,
                pageSize: PAGE_SIZE,
              })
              setUsingOffline(true)
              setWaking(false)
              showToast('Offline mode: using your saved catalog.')
            } else {
              throw err
            }
          }
        }

        const rawList = data.results ?? data
        setSongs(rawList)
        setTotal(data.count ?? rawList.length)
      } catch (err) {
        if (err.name === 'AbortError') return
        setWaking(false)
        setError(
          err.message?.includes('waking') || err.name === 'AbortError'
            ? 'Server is waking up (free plan). Tap retry in a few seconds.'
            : err.message || 'Could not load the songbook.',
        )
        setSongs([])
        setTotal(0)
      } finally {
        setLoading(false)
      }
    }

    load()
    return () => controller.abort()
  }, [filterKey, debouncedQuery, selectedLetter, selectedCategory, page, online, reloadToken])

  const goToPage = (nextPage) => {
    const clamped = Math.min(Math.max(1, nextPage), totalPages)
    if (clamped === page) return
    setPage(clamped)
    listRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const handleToggleFavorite = (song) => {
    const { next, added } = toggleFavorite(song)
    setFavorites(next)
    showToast(added ? `Saved: ${song.title}` : `Removed from favorites: ${song.title}`)
  }

  const openAccountForOffline = () => {
    setShowAccount(true)
  }

  const handleSyncOffline = async () => {
    if (!account?.authenticated || !hasOfflineAccess) {
      openAccountForOffline()
      showToast(
        account?.authenticated
          ? 'Offline Pass subscription required.'
          : 'Sign in and subscribe to unlock Offline.',
      )
      return
    }
    if (!online) {
      showToast('Internet is required to download the offline catalog.')
      return
    }
    setSyncingOffline(true)
    try {
      const pack = await fetchOfflinePack()
      const results = pack.results || []
      if (!results.length) {
        throw new Error('Server returned an empty catalog.')
      }
      const meta = await saveOfflineCatalog(results)
      setOfflineMeta(meta)
      showToast(`Offline ready: ${meta.count.toLocaleString()} songs saved on this device.`)
    } catch (err) {
      if (err.code === 'login_required' || err.status === 401) {
        openAccountForOffline()
      } else if (err.code === 'subscription_required' || err.status === 403) {
        openAccountForOffline()
      }
      showToast(err.message || 'Failed to save offline catalog.')
    } finally {
      setSyncingOffline(false)
    }
  }

  const handleSubmitReport = async (e) => {
    e.preventDefault()
    if (!reportSong) return
    setReportBusy(true)
    try {
      const result = await reportWrongNumber({
        song: reportSong.id,
        platinum_number: reportSong.platinum_number,
        title: reportSong.title,
        artist: reportSong.artist,
        suggested_number: reportSuggested.trim(),
        note: reportNote.trim(),
      })
      showToast(result.message || 'Report submitted.')
      setReportSong(null)
      setReportNote('')
      setReportSuggested('')
    } catch (err) {
      showToast(err.message || 'Could not submit the report.')
    } finally {
      setReportBusy(false)
    }
  }

  if (showAdminLogin) {
    return <AdminGate onBack={closeAdminLogin} />
  }

  return (
    <div className="songbook-container" ref={containerRef}>
      {toast ? (
        <div className="songbook-toast" role="status">
          {toast}
        </div>
      ) : null}

      <div className="songbook-binder">
        <div className="binder-rings" aria-hidden="true">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="ring">
              <div className="ring-hole left" />
              <div className="ring-loop" />
              <div className="ring-hole right" />
            </div>
          ))}
        </div>

        <div className="songbook-page">
          <header className="songbook-header">
            {!online ? (
              <div
                className={`offline-live-banner ${offlineMeta?.count ? 'has-catalog' : 'needs-pass'}`}
                role="status"
              >
                <div className="offline-live-copy">
                  <strong>{offlineMeta?.count ? 'Offline mode' : 'You’re offline'}</strong>
                  <span>
                    {offlineMeta?.count
                      ? `Using saved catalog · ${offlineMeta.count.toLocaleString()} songs`
                      : 'No saved catalog yet — Offline Pass setup needed when online.'}
                  </span>
                </div>
                <button
                  type="button"
                  className="offline-live-btn"
                  onClick={() =>
                    offlineMeta?.count ? setShowInstallApp(true) : setShowAccount(true)
                  }
                >
                  {offlineMeta?.count ? 'Offline Setup' : 'Offline Pass'}
                </button>
              </div>
            ) : null}
            <div className="header-badge">THE PLATINUM KARAOKE</div>
            <h1 className="songbook-title">OFFICIAL SONGBOOK</h1>
            <p className="songbook-subtitle">
              Look up a title or artist and get the song number right away.
            </p>
            <p className="source-note">
              Source: Trust me Bro
            </p>

            <div className="toolbar" role="toolbar" aria-label="Songbook tools">
              <div className="toolbar-group">
                <button
                  type="button"
                  className="toolbar-btn"
                  onClick={() => setShowFavorites(true)}
                >
                  <svg className="toolbar-ico" viewBox="0 0 24 24" aria-hidden="true">
                    <path
                      d="M12 4.5l2.1 4.3 4.7.7-3.4 3.3.8 4.7L12 15.4 7.8 17.5l.8-4.7-3.4-3.3 4.7-.7L12 4.5z"
                      fill="currentColor"
                    />
                  </svg>
                  <span className="toolbar-btn-text">
                    Favorites
                    <em>{favorites.length}</em>
                  </span>
                </button>
                <button
                  type="button"
                  className={`toolbar-btn ${offlineMeta && hasOfflineAccess ? 'is-ready' : ''}`}
                  onClick={handleSyncOffline}
                  disabled={syncingOffline}
                >
                  <svg className="toolbar-ico" viewBox="0 0 24 24" aria-hidden="true">
                    <path
                      d="M7 18h10a4 4 0 0 0 .3-8 5.5 5.5 0 0 0-10.6 1.5A3.5 3.5 0 0 0 7 18z"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinejoin="round"
                    />
                    {offlineMeta && hasOfflineAccess ? (
                      <path
                        d="M9.5 12.5l2 2 3.5-3.5"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                      />
                    ) : (
                      <path
                        d="M12 11v4m0 0l-1.5-1.5M12 15l1.5-1.5"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                      />
                    )}
                  </svg>
                  <span className="toolbar-btn-text">
                    {syncingOffline
                      ? 'Downloading…'
                      : !hasOfflineAccess
                        ? 'Offline Pass'
                        : offlineMeta
                          ? 'Offline'
                          : 'Save Offline'}
                    {offlineMeta && hasOfflineAccess && !syncingOffline ? (
                      <em>{offlineMeta.count.toLocaleString()}</em>
                    ) : null}
                  </span>
                </button>
                <button
                  type="button"
                  className="toolbar-btn"
                  onClick={() => setShowJoinQr(true)}
                >
                  <svg className="toolbar-ico" viewBox="0 0 24 24" aria-hidden="true">
                    <path
                      d="M4 4h7v7H4V4zm2 2v3h3V6H6zm7-2h7v7h-7V4zm2 2v3h3V6h-3zM4 13h7v7H4v-7zm2 2v3h3v-3H6zm9 0h2v2h-2v-2zm4 0h2v2h-2v-2zm-4 4h2v2h-2v-2zm4 0h2v3h-5v-2h3v-1z"
                      fill="currentColor"
                    />
                  </svg>
                  <span className="toolbar-btn-text">QR Join</span>
                </button>
                <button
                  type="button"
                  className={`toolbar-btn ${appInstalled && offlineMeta && hasOfflineAccess ? 'is-ready' : ''}`}
                  onClick={() => setShowInstallApp(true)}
                >
                  <svg className="toolbar-ico" viewBox="0 0 24 24" aria-hidden="true">
                    <path
                      d="M12 3v10m0 0l-3.5-3.5M12 13l3.5-3.5M5 17.5V19a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-1.5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  <span className="toolbar-btn-text">
                    {appInstalled ? 'Offline Setup' : 'Install App'}
                  </span>
                </button>
                <button
                  type="button"
                  className={`toolbar-btn ${hasOfflineAccess ? 'is-ready' : ''}`}
                  onClick={() => setShowAccount(true)}
                >
                  <svg className="toolbar-ico" viewBox="0 0 24 24" aria-hidden="true">
                    <circle cx="12" cy="8" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.8" />
                    <path
                      d="M5 19c1.8-3 4.2-4.5 7-4.5S16.2 16 18 19"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                    />
                  </svg>
                  <span className="toolbar-btn-text">
                    {account?.authenticated ? 'Account' : 'Sign in'}
                  </span>
                </button>
              </div>

              <div className="toolbar-group toolbar-group-end">
                <button
                  type="button"
                  className="toolbar-btn admin"
                  onClick={openAdminLogin}
                >
                  <svg className="toolbar-ico" viewBox="0 0 24 24" aria-hidden="true">
                    <circle cx="12" cy="8" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.8" />
                    <path
                      d="M5 19c1.4-3.2 4-5 7-5s5.6 1.8 7 5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                    />
                  </svg>
                  <span className="toolbar-btn-text">Admin</span>
                </button>
                <span
                  className={`net-pill ${online ? 'online' : 'offline'}`}
                  title={
                    online
                      ? usingOffline
                        ? 'Online with offline cache'
                        : 'Connected'
                      : 'No network'
                  }
                >
                  <span className="net-dot" aria-hidden="true" />
                  {online ? (usingOffline ? 'Online · Cache' : 'Online') : 'Offline'}
                </span>
              </div>
            </div>
          </header>

          <section className="search-section">
            <div className={`songbook-search-box ${query ? 'has-query' : ''}`}>
              <span className="search-icon-wrap" aria-hidden="true">
                <svg className="search-icon" viewBox="0 0 24 24">
                  <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" fill="none" />
                  <path d="M20 20l-3.5-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </span>
              <div className="search-field">
                <label className="search-label" htmlFor="songbook-search">
                  Find a song
                </label>
                <input
                  id="songbook-search"
                  name="q"
                  type="search"
                  enterKeyHint="search"
                  autoComplete="off"
                  spellCheck="false"
                  placeholder="Title, artist, or song number…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              {query ? (
                <button
                  type="button"
                  className="clear-btn"
                  onClick={() => setQuery('')}
                  title="Clear search"
                  aria-label="Clear search"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path
                      d="M7 7l10 10M17 7L7 17"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
              ) : (
                <span className="search-hint" aria-hidden="true">
                  Search
                </span>
              )}
            </div>

            <div className="category-bar">
              <span className="category-label">Category:</span>
              <div className="category-pills">
                {CATEGORIES.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    className={`cat-pill ${selectedCategory === cat ? 'active' : ''}`}
                    onClick={() => setSelectedCategory(cat)}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>

            <div className="alphabet-bar">
              <div className="alphabet-label-wrap">
                <span className="alphabet-label">A–Z</span>
                <span className="alphabet-label-sub">
                  {selectedLetter === 'ALL' ? 'Index' : selectedLetter}
                </span>
              </div>
              <div className="alphabet-rail">
                <button
                  type="button"
                  className={`alphabet-btn is-all alphabet-all-pin ${selectedLetter === 'ALL' ? 'active' : ''}`}
                  onClick={() => setSelectedLetter('ALL')}
                  aria-pressed={selectedLetter === 'ALL'}
                >
                  All
                </button>
                <div
                  className="alphabet-scroll"
                  role="group"
                  aria-label="Jump to letter"
                  ref={alphabetScrollRef}
                >
                  {ALPHABET.filter((letter) => letter !== 'ALL').map((letter) => (
                    <button
                      key={letter}
                      type="button"
                      className={`alphabet-btn ${selectedLetter === letter ? 'active' : ''}`}
                      onClick={() => setSelectedLetter(letter)}
                      aria-pressed={selectedLetter === letter}
                    >
                      {letter}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <div className="directory-status">
            <span className="status-text">
              {waking
                ? 'Waking free server… first open can take up to a minute.'
                : loading
                  ? 'Searching the catalog…'
                  : `${usingOffline ? 'Offline catalog' : 'Songbook'}: ${total.toLocaleString()} songs · ${rangeStart}–${rangeEnd} · Page ${total ? page : 0} of ${total ? totalPages : 0}`}
            </span>
          </div>

          <main className="songbook-list" ref={listRef}>
            {error ? (
              <div className="songbook-message error">
                <p>{error}</p>
                <button
                  type="button"
                  className="toolbar-btn"
                  style={{ marginTop: '0.75rem' }}
                  onClick={() => {
                    setError('')
                    setWaking(false)
                    setReloadToken((n) => n + 1)
                  }}
                >
                  Retry
                </button>
              </div>
            ) : null}

            {!loading && !error && songs.length === 0 ? (
              <div className="songbook-message empty">
                <p>No songs found in the songbook.</p>
                <small>
                  {!online && !offlineMeta
                    ? 'No offline catalog yet. Go online and tap "Save Offline".'
                    : 'Try a different spelling, artist, or tap ALL in the A-Z index.'}
                </small>
              </div>
            ) : null}

            {songs.map((song) => {
              const fav = favorites.some((f) => f.id === song.id) || isFavorite(song.id)
              return (
                <article key={song.id} className="songbook-row">
                  <div className="code-display">
                    <span className="code-label">PLATINUM</span>
                    <span className="code-number">{song.platinum_number}</span>
                  </div>

                  <div className="song-info">
                    <div className="song-title-row">
                      <h2 className="song-title">{song.title}</h2>
                      <div className="dots-leader" aria-hidden="true" />
                    </div>
                    <div className="song-sub-row">
                      <span className="song-artist">{song.artist || 'Unknown artist'}</span>
                      <div className="song-tags">
                        {song.language ? <span className="tag-lang">{song.language}</span> : null}
                      </div>
                    </div>
                    <div className="row-actions">
                      <button
                        type="button"
                        className={`mini-btn ${fav ? 'is-fav' : ''}`}
                        onClick={() => handleToggleFavorite(song)}
                      >
                        {fav ? '★ Saved' : '☆ Save'}
                      </button>
                      <button
                        type="button"
                        className="mini-btn danger"
                        onClick={() => {
                          setReportSong(song)
                          setReportNote('')
                          setReportSuggested('')
                        }}
                      >
                        Report
                      </button>
                    </div>
                  </div>
                </article>
              )
            })}
          </main>

          {total > 0 ? (
            <nav className="pagination" aria-label="Songbook pages">
              <button
                type="button"
                className="pagination-btn"
                disabled={loading || page <= 1}
                onClick={() => goToPage(page - 1)}
              >
                Previous
              </button>

              <div className="pagination-pages">
                {getPageItems(page, totalPages).map((item, index) =>
                  item === '…' ? (
                    <span key={`ellipsis-${index}`} className="pagination-ellipsis">
                      …
                    </span>
                  ) : (
                    <button
                      key={item}
                      type="button"
                      className={`pagination-page ${page === item ? 'active' : ''}`}
                      disabled={loading}
                      aria-current={page === item ? 'page' : undefined}
                      onClick={() => goToPage(item)}
                    >
                      {item}
                    </button>
                  ),
                )}
              </div>

              <button
                type="button"
                className="pagination-btn"
                disabled={loading || page >= totalPages}
                onClick={() => goToPage(page + 1)}
              >
                Next
              </button>
            </nav>
          ) : null}

          <footer className="songbook-footer">
            <p>
              Song codes for your machine · Favorites & offline work on this device
            </p>
            <button type="button" className="footer-admin-link" onClick={openAdminLogin}>
              Admin Login — add or fix songs
            </button>
          </footer>
        </div>
      </div>

      {showFavorites ? (
        <div
          className="drawer-overlay centered-overlay"
          onClick={() => setShowFavorites(false)}
        >
          <div
            className="drawer-card centered-card"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="favorites-title"
          >
            <div className="drawer-header">
              <div>
                <h2 id="favorites-title">Favorites ({favorites.length})</h2>
                <p>Saved on this device for quick access.</p>
              </div>
              <button type="button" className="close-drawer-btn" onClick={() => setShowFavorites(false)}>
                ✕
              </button>
            </div>
            <div className="drawer-body">
              {favorites.length === 0 ? (
                <p className="empty-drawer-msg">No favorites yet. Tap ☆ Save on a song.</p>
              ) : (
                <ul className="reserved-list">
                  {favorites.map((song) => (
                    <li key={song.id} className="reserved-item">
                      <span className="reserved-code">{song.platinum_number}</span>
                      <div className="reserved-details">
                        <strong>{song.title}</strong>
                        <small>{song.artist}</small>
                      </div>
                      <button
                        type="button"
                        className="remove-item-btn"
                        onClick={() => setFavorites(removeFavorite(song.id))}
                      >
                        ✕
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="drawer-footer">
              <button
                type="button"
                className="clear-all-btn"
                disabled={favorites.length === 0}
                onClick={() => {
                  setFavorites(clearFavorites())
                  showToast('Favorites cleared.')
                }}
              >
                Clear all favorites
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {reportSong ? (
        <div className="drawer-overlay" onClick={() => setReportSong(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-header">
              <div>
                <h2>Report Wrong Number</h2>
                <p>
                  {reportSong.title} · current code <strong>{reportSong.platinum_number}</strong>
                </p>
              </div>
              <button type="button" className="close-drawer-btn" onClick={() => setReportSong(null)}>
                ✕
              </button>
            </div>
            <form className="report-form" onSubmit={handleSubmitReport}>
              <label htmlFor="report-suggested">
                Suggested correct number (optional)
                <input
                  id="report-suggested"
                  name="suggested_number"
                  type="text"
                  value={reportSuggested}
                  onChange={(e) => setReportSuggested(e.target.value)}
                  placeholder="e.g. 1134"
                />
              </label>
              <label htmlFor="report-note">
                What is wrong?
                <textarea
                  id="report-note"
                  name="note"
                  required
                  minLength={5}
                  rows={4}
                  value={reportNote}
                  onChange={(e) => setReportNote(e.target.value)}
                  placeholder="e.g. This number is wrong on our machine…"
                />
              </label>
              <button type="submit" className="load-more-btn" disabled={reportBusy}>
                {reportBusy ? 'Submitting…' : 'Submit report'}
              </button>
            </form>
          </div>
        </div>
      ) : null}

      {showJoinQr ? (
        <JoinQrModal onClose={() => setShowJoinQr(false)} />
      ) : null}

      {showInstallApp ? (
        <InstallAppModal
          onClose={() => setShowInstallApp(false)}
          offlineMeta={offlineMeta}
          syncingOffline={syncingOffline}
          onSaveOffline={handleSyncOffline}
          installed={appInstalled}
          ios={ios}
          canPromptInstall={canPromptInstall}
          promptInstall={promptInstall}
          hasOfflineAccess={hasOfflineAccess}
          onOpenAccount={openAccountForOffline}
        />
      ) : null}

      {showAccount ? (
        <AccountModal
          onClose={() => setShowAccount(false)}
          account={account}
          onAccountChange={(next) => {
            setAccount(next?.authenticated ? next : { authenticated: false })
            if (next?.offline_access) {
              adminMe().then((me) => {
                if (me?.authenticated) setAccount(me)
              })
            }
          }}
          syncingOffline={syncingOffline}
          onSaveOffline={handleSyncOffline}
        />
      ) : null}
    </div>
  )
}
