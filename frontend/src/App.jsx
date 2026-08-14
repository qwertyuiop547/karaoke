import { useEffect, useRef, useState } from 'react'
import gsap from 'gsap'
import { useGSAP } from '@gsap/react'
import AdminGate from './AdminGate'
import {
  searchSongs,
  fetchOfflinePack,
  reportWrongNumber,
  adminMe,
  startOfflineTrial,
  verifyEmailToken,
} from './api'
import { usePresencePing } from './usePresencePing'
import {
  FREE_FAVORITE_LIMIT,
  getFavorites,
  toggleFavorite,
  removeFavorite,
  clearFavorites,
  isFavoriteLocked,
  countLockedFavorites,
  isFavorite,
} from './favorites'
import {
  getOfflineMeta,
  needsOfflineAutoSync,
  saveOfflineCatalog,
  searchOfflineCatalog,
  touchOfflineChecked,
  clearOfflineCatalog,
  setOfflineAccessUntil,
  hasLocalOfflineAccess,
  hasOfflineGraceAccess,
  getOfflineAccessMode,
  getOfflineGraceUntil,
  startOfflineGracePeriod,
  clearOfflineGrace,
  formatCatalogChangelog,
} from './offline'
import {
  addToQueue,
  clearDoneQueue,
  clearQueue,
  getQueue,
  markQueueDone,
  markQueuePending,
  moveQueueItem,
  removeFromQueue,
} from './singQueue'
import JoinQrModal from './JoinQrModal'
import InstallAppModal from './InstallAppModal'
import AccountModal from './AccountModal'
import PassModal from './PassModal'
import { usePwaInstall } from './usePwaInstall'
import { useConnectivity } from './useConnectivity'
import { consumeJoinParam, consumeReferralParam } from './joinUrl'
import {
  markSubscribeNudgeShown,
  msUntilNextSubscribeNudge,
  shouldNudgeSubscribe,
  subscribeNudgeCopy,
  SUBSCRIBE_NUDGE_INTERVAL_MS,
  SUBSCRIBE_NUDGE_SESSION_DELAY_MS,
} from './subscribeNudge'
import { getPassStatusInfo } from './passBenefits'
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
  const [queue, setQueue] = useState(() => getQueue())
  const [showQueue, setShowQueue] = useState(false)

  const [offlineMeta, setOfflineMeta] = useState(() => getOfflineMeta())
  const [syncingOffline, setSyncingOffline] = useState(false)
  const syncingOfflineRef = useRef(false)
  const autoSyncTimerRef = useRef(null)

  const [reportSong, setReportSong] = useState(null)
  const [reportNote, setReportNote] = useState('')
  const [reportSuggested, setReportSuggested] = useState('')
  const [reportBusy, setReportBusy] = useState(false)

  const [toast, setToast] = useState('')
  const [showJoinQr, setShowJoinQr] = useState(false)
  const [showInstallApp, setShowInstallApp] = useState(false)
  const [showPass, setShowPass] = useState(false)
  const [passReason, setPassReason] = useState('')
  const [passNudgeCopy, setPassNudgeCopy] = useState(null)
  const [showAccount, setShowAccount] = useState(false)
  const [accountMode, setAccountMode] = useState('register')
  const [resetToken, setResetToken] = useState('')
  const [account, setAccount] = useState({ authenticated: false })
  const { installed: appInstalled, ios, canPromptInstall, promptInstall } = usePwaInstall()
  const [showAdminLogin, setShowAdminLogin] = useState(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('join') === '1') return false
    return window.location.hash === '#admin'
  })

  usePresencePing(showAdminLogin ? 'admin' : 'songbook')

  const hasOfflineAccess = Boolean(account?.offline_access)
  const passStatus = getPassStatusInfo(account)
  const offlineAccessMode = getOfflineAccessMode()
  const offlineGraceActive = offlineAccessMode === 'grace'
  const canUseOfflineCatalog =
    hasOfflineAccess || hasLocalOfflineAccess() || hasOfflineGraceAccess()
  const prevOfflineAccessRef = useRef(null)
  const trialExpiryTimerRef = useRef(null)
  const subscribeNudgeTimerRef = useRef(null)
  const accountRef = useRef(account)
  const modalBusyRef = useRef(false)
  accountRef.current = account
  modalBusyRef.current =
    showPass ||
    showAccount ||
    showInstallApp ||
    showAdminLogin ||
    showFavorites ||
    showQueue ||
    showJoinQr

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
    window.setTimeout(() => setToast(''), 3200)
  }

  const revokeLocalPassEntitlements = async (reason = '', { quiet = false, allowGrace = true } = {}) => {
    const hadCatalog = Boolean(getOfflineMeta()?.count)
    const lockedCount = countLockedFavorites(getFavorites())
    const deviceOffline =
      typeof navigator !== 'undefined' && navigator.onLine === false

    if (
      allowGrace &&
      deviceOffline &&
      hadCatalog &&
      !hasLocalOfflineAccess() &&
      !hasOfflineGraceAccess()
    ) {
      startOfflineGracePeriod()
      setUsingOffline(true)
      setFavorites(getFavorites())
      if (quiet) return
      if (reason) {
        showToast(`${reason} Offline grace: saved catalog works for 24h — reconnect to renew.`)
      } else {
        showToast(
          'Pass ended offline — 24h grace to search your saved catalog. Reconnect to renew.',
        )
      }
      return
    }

    if (hadCatalog && hasOfflineGraceAccess() && deviceOffline) {
      setUsingOffline(true)
      setFavorites(getFavorites())
      if (!quiet && reason) showToast(reason)
      return
    }

    await clearOfflineCatalog()
    setOfflineMeta(null)
    setUsingOffline(false)
    setFavorites(getFavorites())
    if (quiet) return
    if (reason) showToast(reason)
    else if (hadCatalog) {
      showToast('Free trial ended — offline catalog locked. Subscribe to restore access.')
    } else if (lockedCount > 0) {
      showToast(
        `${lockedCount} favorite${lockedCount === 1 ? '' : 's'} locked — Subscribe now to unlock.`,
      )
    }
  }

  const syncPassAccessWindow = (me) => {
    if (!me?.authenticated || !me?.offline_access) {
      setOfflineAccessUntil(null)
      return null
    }
    const sub = me.subscription || {}
    // Never invent a local expiry. A missing or malformed server expiry used
    // to create a one-year offline window, which could keep a trial usable
    // beyond its actual end date.
    const until = sub.manual_override_until || sub.current_period_end
    if (!until || !Number.isFinite(new Date(until).getTime()) || new Date(until).getTime() <= Date.now()) {
      setOfflineAccessUntil(null)
      return null
    }
    setOfflineAccessUntil(until)
    return until
  }

  const applyAccountState = async (
    me,
    { announceExpiry = true, forceLocalRevoke = false } = {},
  ) => {
    const next = me?.authenticated ? me : { authenticated: false }
    const hadAccess = prevOfflineAccessRef.current
    const hasAccess = Boolean(next.offline_access)

    // Offline + still-valid local Pass: don't wipe catalog just because /me failed.
    if (
      !next.authenticated &&
      !forceLocalRevoke &&
      hasLocalOfflineAccess() &&
      typeof navigator !== 'undefined' &&
      navigator.onLine === false
    ) {
      setAccount(next)
      return next
    }

    setAccount(next)
    prevOfflineAccessRef.current = hasAccess

    if (hasAccess) {
      syncPassAccessWindow(next)
      clearOfflineGrace()
      return next
    }

    setOfflineAccessUntil(null)
    const meta = getOfflineMeta()
    const deviceOffline =
      typeof navigator !== 'undefined' && navigator.onLine === false
    if (deviceOffline && meta?.count && !forceLocalRevoke) {
      await revokeLocalPassEntitlements(
        announceExpiry && hadAccess === true
          ? 'Free trial / Pass ended.'
          : '',
        {
          quiet: !(announceExpiry && hadAccess === true),
          allowGrace: true,
        },
      )
      return next
    }

    if (meta?.count || hadAccess === true) {
      await revokeLocalPassEntitlements(
        announceExpiry && hadAccess === true
          ? 'Free trial / Pass ended — offline catalog removed. Subscribe to unlock again.'
          : '',
        { quiet: !(announceExpiry && hadAccess === true) },
      )
    }
    return next
  }

  useEffect(() => {
    const refCode = consumeReferralParam()
    if (refCode) {
      showToast(`Referral code ${refCode} captured! Sign up for +3 bonus trial days.`)
    }

    if (consumeJoinParam()) {
      if (window.location.hash === '#admin') {
        window.history.replaceState(null, '', window.location.pathname + window.location.search)
      }
      setShowAdminLogin(false)
      showToast('Welcome! Search a title or artist to get the song number.')
    }

    const params = new URLSearchParams(window.location.search)
    const billing = params.get('billing')
    const verifyToken = params.get('verify_email')
    const urlResetToken = params.get('reset_token') || params.get('reset_password')
    if (urlResetToken) {
      params.delete('reset_token')
      params.delete('reset_password')
      const next = `${window.location.pathname}${params.toString() ? `?${params}` : ''}${window.location.hash}`
      window.history.replaceState(null, '', next)
      setResetToken(urlResetToken)
      setAccountMode('reset')
      setShowAccount(true)
      showToast('Enter your new password to reset your account.')
    } else if (verifyToken) {
      params.delete('verify_email')
      const next = `${window.location.pathname}${params.toString() ? `?${params}` : ''}${window.location.hash}`
      window.history.replaceState(null, '', next)
      verifyEmailToken(verifyToken)
        .then((me) => {
          applyAccountState(me?.authenticated ? me : { authenticated: false }, {
            announceExpiry: false,
          })
          setShowAccount(true)
          showToast('Email verified — you can start your Offline Pass trial.')
        })
        .catch((err) => {
          showToast(err.message || 'Email verification failed.')
          setShowAccount(true)
        })
    } else if (billing === 'success') {
      showToast('Offline Pass activated — you can save the catalog now.')
      params.delete('billing')
      params.delete('session_id')
      const next = `${window.location.pathname}${params.toString() ? `?${params}` : ''}${window.location.hash}`
      window.history.replaceState(null, '', next)
      adminMe()
        .then((me) => {
          if (me?.authenticated) applyAccountState(me, { announceExpiry: false })
        })
        .catch(() => {})
      setShowAccount(true)
    } else if (billing === 'cancel') {
      showToast('Checkout canceled.')
      params.delete('billing')
      const next = `${window.location.pathname}${params.toString() ? `?${params}` : ''}${window.location.hash}`
      window.history.replaceState(null, '', next)
    }

    if (!verifyToken) {
      adminMe()
        .then((me) => applyAccountState(me, { announceExpiry: false }))
        .catch(() => {
          // Don't wipe a still-valid local Pass window just because /me failed offline.
          if (hasLocalOfflineAccess()) return
          applyAccountState({ authenticated: false }, { announceExpiry: false })
        })
    }

    // Cold start: expired local Pass window → wipe stale catalog immediately.
    if (!hasLocalOfflineAccess() && !hasOfflineGraceAccess() && getOfflineMeta()?.count) {
      clearOfflineCatalog().then(() => {
        setOfflineMeta(null)
      })
    }
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
      const allowed = canUseOfflineCatalog
      setOfflineMeta(allowed ? meta : null)
      // Only push Offline Pass UI when the *device* reports no network.
      // Slow API alone should not spam the install modal.
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        if (allowed && meta?.count) {
          showToast(
            offlineGraceActive
              ? `Grace mode · ${meta.count.toLocaleString()} songs until reconnect`
              : `Offline mode · ${meta.count.toLocaleString()} songs on this device`,
          )
        } else {
          showToast('Offline Pass required — free plan can’t use offline catalog.')
          openPassOffer(
            'Your free trial ended (or isn’t active). Subscribe to keep offline search.',
          )
        }
      } else {
        showToast('Server unreachable — retrying…')
      }
    } else if (wasOnline === false) {
      showToast('Back online')
      // Cheap If-None-Match probe whenever we regain connectivity.
      if (autoSyncTimerRef.current) {
        window.clearTimeout(autoSyncTimerRef.current)
      }
      autoSyncTimerRef.current = window.setTimeout(() => {
        autoSyncTimerRef.current = null
        const meta = getOfflineMeta()
        if (!meta?.count || !hasOfflineAccess) return
        handleSyncOffline({ quiet: true })
      }, 800)
      // Re-check entitlements after reconnect (trial may have ended; end grace).
      adminMe()
        .then((me) =>
          applyAccountState(me, {
            announceExpiry: true,
            forceLocalRevoke: hasOfflineGraceAccess(),
          }),
        )
        .catch(() => {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online, hasOfflineAccess])

  // Cold start already offline (installed PWA opened without network).
  useEffect(() => {
    if (online) return
    if (typeof navigator !== 'undefined' && navigator.onLine !== false) return
    const allowed = canUseOfflineCatalog
    const meta = allowed ? getOfflineMeta() : null
    setOfflineMeta(meta)
    if (!meta?.count) {
      setShowInstallApp(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // When trial/Pass period ends while the app stays open, revoke immediately.
  useEffect(() => {
    if (trialExpiryTimerRef.current) {
      window.clearTimeout(trialExpiryTimerRef.current)
      trialExpiryTimerRef.current = null
    }
    if (!hasOfflineAccess) return undefined

    const untilIso =
      account?.subscription?.manual_override_until ||
      account?.subscription?.current_period_end
    if (!untilIso) return undefined

    const ms = new Date(untilIso).getTime() - Date.now()
    if (!Number.isFinite(ms)) return undefined

    if (ms <= 0) {
      adminMe()
        .then((me) => applyAccountState(me))
        .catch(() => revokeLocalPassEntitlements())
      return undefined
    }

    // setTimeout max ~24.8 days; clamp for long paid periods (poll instead).
    const delay = Math.min(ms + 250, 6 * 60 * 60 * 1000)
    trialExpiryTimerRef.current = window.setTimeout(() => {
      trialExpiryTimerRef.current = null
      adminMe()
        .then((me) => applyAccountState(me))
        .catch(() => {
          if (!hasLocalOfflineAccess()) revokeLocalPassEntitlements()
        })
    }, delay)

    return () => {
      if (trialExpiryTimerRef.current) {
        window.clearTimeout(trialExpiryTimerRef.current)
        trialExpiryTimerRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    hasOfflineAccess,
    account?.subscription?.current_period_end,
    account?.subscription?.manual_override_until,
  ])

  // Soft entitlement refresh while signed in (catches admin revoke / trial end).
  useEffect(() => {
    if (!account?.authenticated) return undefined
    const tick = () => {
      adminMe()
        .then((me) => applyAccountState(me))
        .catch(() => {})
    }
    const id = window.setInterval(tick, 5 * 60 * 1000)
    return () => window.clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account?.authenticated])

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
          if (!(hasOfflineAccess || hasLocalOfflineAccess()) || !getOfflineMeta()?.count) {
            throw new Error(
              'Offline Pass required. Free plan can’t use the saved catalog — subscribe to unlock again.',
            )
          }
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
            const allowed = hasOfflineAccess || hasLocalOfflineAccess()
            const meta = allowed ? getOfflineMeta() : null
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
  }, [
    filterKey,
    debouncedQuery,
    selectedLetter,
    selectedCategory,
    page,
    online,
    reloadToken,
    hasOfflineAccess,
  ])

  const goToPage = (nextPage) => {
    const clamped = Math.min(Math.max(1, nextPage), totalPages)
    if (clamped === page) return
    setPage(clamped)
    listRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const handleToggleFavorite = (song) => {
    const result = toggleFavorite(song, { unlimited: hasOfflineAccess })
    if (result.blocked) {
      openPassOffer(
        `Free plan allows ${FREE_FAVORITE_LIMIT} favorites. Get Offline Pass for unlimited saves.`,
      )
      showToast(`Favorite limit reached (${FREE_FAVORITE_LIMIT}). Unlock Offline Pass.`)
      return
    }
    setFavorites(result.next)
    showToast(
      result.added ? `Saved: ${song.title}` : `Removed from favorites: ${song.title}`,
    )
  }

  const handleAddToQueue = (song) => {
    const result = addToQueue(song)
    setQueue(result.next)
    if (result.alreadyQueued) {
      showToast(`Already in tonight's queue: ${song.title}`)
      return
    }
    showToast(`Queued: ${song.title}`)
  }

  const pendingQueue = queue.filter((row) => row.status !== 'done')
  const doneQueue = queue.filter((row) => row.status === 'done')

  /** Dedicated Pass benefits modal — Get Pass → sign up / login. */
  const openPassOffer = (reason = '', nudgeCopy = null) => {
    if (hasOfflineAccess) {
      setAccountMode('register')
      setShowAccount(true)
      return
    }
    setPassReason(reason)
    setPassNudgeCopy(nudgeCopy)
    setShowPass(true)
  }

  const openSubscribeNudge = () => {
    const me = accountRef.current
    if (!shouldNudgeSubscribe(me)) return false
    if (modalBusyRef.current) return false
    const copy = subscribeNudgeCopy(me)
    markSubscribeNudgeShown(me?.email)
    openPassOffer(copy.reason, {
      kicker: copy.kicker,
      headline: copy.title,
      lead: copy.lead,
    })
    return true
  }

  const openAccountFromPass = (mode = 'register') => {
    setShowPass(false)
    setPassReason('')
    setPassNudgeCopy(null)
    setAccountMode(mode)
    setShowAccount(true)
  }

  const handleStartTrialFromPass = async () => {
    try {
      const data = await startOfflineTrial()
      await applyAccountState({
        ...(account || {}),
        authenticated: true,
        offline_access: data.offline_access,
        subscription: data.subscription,
        email_verified: data.email_verified ?? account?.email_verified,
      })
      setShowPass(false)
      setPassReason('')
      setPassNudgeCopy(null)
      setShowAccount(true)
      showToast('Free trial started — save the offline catalog now.')
    } catch (err) {
      showToast(err.message || 'Could not start free trial.')
      openAccountFromPass('register')
    }
  }

  const openAccountForOffline = (reason = '') => {
    openPassOffer(reason)
  }

  // After free trial ends: encourage Subscribe now about every 5 hours.
  useEffect(() => {
    if (subscribeNudgeTimerRef.current) {
      window.clearTimeout(subscribeNudgeTimerRef.current)
      subscribeNudgeTimerRef.current = null
    }
    if (!shouldNudgeSubscribe(account)) return undefined

    const email = account?.email || ''
    const remaining = msUntilNextSubscribeNudge(email)
    const delay =
      remaining === 0
        ? SUBSCRIBE_NUDGE_SESSION_DELAY_MS
        : Math.min(remaining, SUBSCRIBE_NUDGE_INTERVAL_MS)

    const schedule = (ms) => {
      subscribeNudgeTimerRef.current = window.setTimeout(() => {
        subscribeNudgeTimerRef.current = null
        const shown = openSubscribeNudge()
        if (!shown) {
          // Another modal is open — retry shortly.
          schedule(45000)
          return
        }
        schedule(SUBSCRIBE_NUDGE_INTERVAL_MS)
      }, ms)
    }

    schedule(delay)

    return () => {
      if (subscribeNudgeTimerRef.current) {
        window.clearTimeout(subscribeNudgeTimerRef.current)
        subscribeNudgeTimerRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    account?.authenticated,
    account?.email,
    account?.offline_access,
    account?.subscription?.trial_used,
    account?.subscription?.is_trialing,
  ])

  const handleSyncOffline = async (opts = {}) => {
    const quiet = Boolean(opts?.quiet)
    const force = Boolean(opts?.force)

    if (!account?.authenticated || !hasOfflineAccess) {
      if (quiet) return { ok: false, reason: 'no_access' }
      openAccountForOffline(
        account?.authenticated
          ? 'Subscribe to Offline Pass to download the full song catalog.'
          : 'Sign in, then see what Offline Pass unlocks before you buy.',
      )
      showToast(
        account?.authenticated
          ? 'Offline Pass subscription required.'
          : 'Sign in and subscribe to unlock Offline.',
      )
      return { ok: false, reason: 'no_access' }
    }
    if (!online) {
      if (!quiet) showToast('Internet is required to download the offline catalog.')
      return { ok: false, reason: 'offline' }
    }
    if (syncingOfflineRef.current) return { ok: false, reason: 'busy' }

    const existing = getOfflineMeta()
    // Quiet auto-update only refreshes an already-saved catalog.
    if (quiet && !force && !existing?.count) {
      return { ok: false, reason: 'no_catalog' }
    }

    syncingOfflineRef.current = true
    if (!quiet) setSyncingOffline(true)
    try {
      const pack = await fetchOfflinePack({
        etag: !force && existing?.etag ? existing.etag : undefined,
      })

      if (pack.notModified) {
        const meta = touchOfflineChecked({ etag: pack.etag || existing?.etag })
        setOfflineMeta(meta)
        return { ok: true, notModified: true, meta }
      }

      const results = pack.results || []
      if (!results.length) {
        throw new Error('Server returned an empty catalog.')
      }
      const prevCount = existing?.count || 0
      const saved = await saveOfflineCatalog(results, { etag: pack.etag })
      const meta = saved.meta || saved
      const changelog = saved.changelog || meta.changelog
      setOfflineMeta(meta)
      syncPassAccessWindow(account)
      clearOfflineGrace()

      const changelogMsg = formatCatalogChangelog(changelog, meta.count)
      if (quiet) {
        if (changelogMsg) showToast(changelogMsg)
        else if (prevCount && meta.count !== prevCount) {
          showToast(`Catalog updated · ${meta.count.toLocaleString()} songs`)
        } else if (!prevCount) {
          showToast(`Offline ready: ${meta.count.toLocaleString()} songs saved on this device.`)
        }
      } else if (changelogMsg) {
        showToast(changelogMsg)
      } else {
        showToast(`Offline ready: ${meta.count.toLocaleString()} songs saved on this device.`)
      }
      return { ok: true, notModified: false, meta, changelog }
    } catch (err) {
      if (!quiet) {
        if (err.code === 'login_required' || err.status === 401) {
          openAccountForOffline()
        } else if (err.code === 'subscription_required' || err.status === 403) {
          openAccountForOffline()
        }
        showToast(err.message || 'Failed to save offline catalog.')
      }
      return { ok: false, reason: 'error', error: err }
    } finally {
      syncingOfflineRef.current = false
      if (!quiet) setSyncingOffline(false)
    }
  }

  const scheduleOfflineAutoSync = (delayMs = 2000) => {
    if (autoSyncTimerRef.current) {
      window.clearTimeout(autoSyncTimerRef.current)
    }
    autoSyncTimerRef.current = window.setTimeout(() => {
      autoSyncTimerRef.current = null
      if (!online || !hasOfflineAccess || !account?.authenticated) return
      const meta = getOfflineMeta()
      if (!needsOfflineAutoSync(meta)) return
      handleSyncOffline({ quiet: true })
    }, delayMs)
  }

  // Quiet catalog freshness check for Offline Pass (existing pack only).
  useEffect(() => {
    if (!online || !hasOfflineAccess || !account?.authenticated) return
    if (!needsOfflineAutoSync(getOfflineMeta())) return
    scheduleOfflineAutoSync(2500)
    return () => {
      if (autoSyncTimerRef.current) {
        window.clearTimeout(autoSyncTimerRef.current)
        autoSyncTimerRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online, hasOfflineAccess, account?.authenticated])

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
            {!online || offlineGraceActive ? (
              <div
                className={`offline-live-banner ${
                  canUseOfflineCatalog && offlineMeta?.count
                    ? offlineGraceActive
                      ? 'grace-catalog'
                      : 'has-catalog'
                    : 'needs-pass'
                }`}
                role="status"
              >
                <div className="offline-live-copy">
                  <strong>
                    {!online
                      ? canUseOfflineCatalog && offlineMeta?.count
                        ? offlineGraceActive
                          ? 'Pass expired · offline grace'
                          : 'Offline mode'
                        : 'You’re offline'
                      : 'Pass expired · reconnect to renew'}
                  </strong>
                  <span>
                    {canUseOfflineCatalog && offlineMeta?.count
                      ? offlineGraceActive
                        ? `Saved catalog still works · ${offlineMeta.count.toLocaleString()} songs · grace ends ${new Date(getOfflineGraceUntil() || 0).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`
                        : `Using saved catalog · ${offlineMeta.count.toLocaleString()} songs`
                      : 'Offline catalog locked — free plan needs Offline Pass.'}
                  </span>
                </div>
                <button
                  type="button"
                  className="offline-live-btn"
                  onClick={() =>
                    canUseOfflineCatalog && offlineMeta?.count
                      ? offlineGraceActive
                        ? openPassOffer(
                            'Your Offline Pass ended. Subscribe now to keep offline search after grace expires.',
                          )
                        : setShowInstallApp(true)
                      : openPassOffer(
                          'Subscribe to Offline Pass to use offline search on this device.',
                        )
                  }
                >
                  {canUseOfflineCatalog && offlineMeta?.count
                    ? offlineGraceActive
                      ? 'Renew Pass'
                      : 'Offline Setup'
                    : 'Subscribe now'}
                </button>
              </div>
            ) : null}
            {online && offlineMeta?.changelog?.added ? (
              <div className="catalog-refresh-banner" role="status">
                <span>
                  Latest sync:{' '}
                  <strong>
                    {offlineMeta.changelog.added.toLocaleString()} new
                    {offlineMeta.changelog.removed
                      ? ` · ${offlineMeta.changelog.removed.toLocaleString()} removed`
                      : ''}
                  </strong>{' '}
                  · {offlineMeta.count.toLocaleString()} songs saved
                </span>
              </div>
            ) : null}
            <div className="header-badge">Partnered by JustQ</div>
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
                    <em>
                      {hasOfflineAccess
                        ? favorites.length
                        : `${favorites.length}/${FREE_FAVORITE_LIMIT}`}
                    </em>
                  </span>
                </button>
                <button
                  type="button"
                  className={`toolbar-btn ${pendingQueue.length ? 'is-ready' : ''}`}
                  onClick={() => setShowQueue(true)}
                >
                  <svg className="toolbar-ico" viewBox="0 0 24 24" aria-hidden="true">
                    <path
                      d="M4 6h16v2H4V6zm0 5h16v2H4v-2zm0 5h10v2H4v-2z"
                      fill="currentColor"
                    />
                  </svg>
                  <span className="toolbar-btn-text">
                    Queue
                    {pendingQueue.length ? <em>{pendingQueue.length}</em> : null}
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
                  onClick={() => {
                    setShowPass(false)
                    setPassReason('')
                    setPassNudgeCopy(null)
                    setShowAccount(false)
                    setShowFavorites(false)
                    setShowInstallApp(true)
                  }}
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
                  onClick={() =>
                    hasOfflineAccess || account?.authenticated
                      ? setShowAccount(true)
                      : openPassOffer()
                  }
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
                {account?.authenticated && passStatus.badgeText ? (
                  <button
                    type="button"
                    className={`toolbar-status-badge status-${passStatus.statusType}`}
                    onClick={() => setShowAccount(true)}
                    title={passStatus.statusText}
                  >
                    <span className="toolbar-status-dot" aria-hidden="true" />
                    <span>{passStatus.badgeText}</span>
                  </button>
                ) : null}
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
                  {!online && !(canUseOfflineCatalog && offlineMeta?.count)
                    ? 'Offline Pass required. Subscribe (or start trial) while online, then save the catalog.'
                    : 'Try a different spelling, artist, or tap ALL in the A-Z index.'}
                </small>
              </div>
            ) : null}

            {songs.map((song) => {
              const fav = favorites.some((f) => f.id === song.id) || isFavorite(song.id)
              const queued = queue.some((row) => row.id === song.id && row.status !== 'done')
              return (
                <article key={song.id} className="songbook-row">
                  <div className="code-display">
                    <span className="code-label">
                      <svg className="code-mic-icon" viewBox="0 0 24 24" width="10" height="10" fill="currentColor">
                        <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
                        <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
                      </svg>
                      PLATINUM
                    </span>
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
                        {song.language ? <span className={`tag-lang ${(song.language || '').toLowerCase()}`}>{song.language}</span> : null}
                      </div>
                    </div>
                    <div className="row-actions">
                      <button
                        type="button"
                        className={`mini-btn ${fav ? 'is-fav' : ''}`}
                        onClick={() => handleToggleFavorite(song)}
                      >
                        <svg className="btn-ico" viewBox="0 0 24 24" width="13" height="13" fill={fav ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
                          <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/>
                        </svg>
                        <span>{fav ? 'Saved' : 'Save'}</span>
                      </button>
                      <button
                        type="button"
                        className={`mini-btn ${queued ? 'is-queued' : ''}`}
                        onClick={() => handleAddToQueue(song)}
                      >
                        {queued ? (
                          <svg className="btn-ico" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12"/>
                          </svg>
                        ) : (
                          <svg className="btn-ico" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="12" y1="5" x2="12" y2="19"/>
                            <line x1="5" y1="12" x2="19" y2="12"/>
                          </svg>
                        )}
                        <span>{queued ? 'Queued' : 'Queue'}</span>
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
                        <svg className="btn-ico" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/>
                          <line x1="4" y1="22" x2="4" y2="15"/>
                        </svg>
                        <span>Report</span>
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
                <h2 id="favorites-title">
                  Favorites ({favorites.length}
                  {!hasOfflineAccess ? ` · ${Math.min(favorites.length, FREE_FAVORITE_LIMIT)} free` : ''})
                </h2>
                <p>
                  {hasOfflineAccess
                    ? 'Unlimited saves with Offline Pass.'
                    : favorites.length > FREE_FAVORITE_LIMIT
                      ? `${countLockedFavorites(favorites)} locked from your trial — Subscribe to unlock.`
                      : `Free: ${FREE_FAVORITE_LIMIT} saves · Pass unlocks unlimited.`}
                </p>
              </div>
              <button type="button" className="close-drawer-btn" onClick={() => setShowFavorites(false)}>
                ✕
              </button>
            </div>
            <div className="drawer-body">
              {!hasOfflineAccess && favorites.length > FREE_FAVORITE_LIMIT ? (
                <div className="favorites-limit-banner">
                  <p>
                    {countLockedFavorites(favorites)} favorite
                    {countLockedFavorites(favorites) === 1 ? '' : 's'} from your trial are{' '}
                    <strong>locked</strong>. Subscribe para makita ulit ang title at song number.
                  </p>
                  <button
                    type="button"
                    className="favorites-limit-cta"
                    onClick={() => {
                      setShowFavorites(false)
                      openPassOffer(
                        'Unlock blurred favorites — Subscribe now for unlimited saves + offline catalog.',
                      )
                    }}
                  >
                    Subscribe now
                  </button>
                </div>
              ) : !hasOfflineAccess && favorites.length >= FREE_FAVORITE_LIMIT ? (
                <div className="favorites-limit-banner">
                  <p>
                    Nakapag-save ka na ng {FREE_FAVORITE_LIMIT}. Mag-Offline Pass para unlimited
                    favorites + full offline catalog.
                  </p>
                  <button
                    type="button"
                    className="favorites-limit-cta"
                    onClick={() => {
                      setShowFavorites(false)
                      openPassOffer(
                        `Free plan allows ${FREE_FAVORITE_LIMIT} favorites. Get Offline Pass for unlimited saves.`,
                      )
                    }}
                  >
                    Subscribe now
                  </button>
                </div>
              ) : null}
              {favorites.length === 0 ? (
                <p className="empty-drawer-msg">No favorites yet. Tap ☆ Save on a song.</p>
              ) : (
                <ul className="reserved-list">
                  {favorites.map((song, index) => {
                    const locked = isFavoriteLocked(index, { hasPass: hasOfflineAccess })
                    return (
                      <li
                        key={song.id}
                        className={`reserved-item ${locked ? 'is-locked' : ''}`}
                      >
                        <span
                          className={`reserved-code ${locked ? 'is-blurred' : ''}`}
                          aria-hidden={locked}
                        >
                          {song.platinum_number}
                        </span>
                        <div className="reserved-details">
                          <strong className={locked ? 'is-blurred' : undefined}>
                            {song.title}
                          </strong>
                          <small className={locked ? 'is-blurred' : undefined}>
                            {song.artist || 'Unknown artist'}
                          </small>
                          {locked ? (
                            <span className="locked-fav-label">Locked · Subscribe to unlock</span>
                          ) : null}
                        </div>
                        {locked ? (
                          <button
                            type="button"
                            className="unlock-fav-btn"
                            onClick={() => {
                              setShowFavorites(false)
                              openPassOffer(
                                'Subscribe now to unlock locked favorites — title + Platinum number.',
                              )
                            }}
                          >
                            Unlock
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="remove-item-btn"
                            onClick={() => setFavorites(removeFavorite(song.id))}
                          >
                            ✕
                          </button>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
            <div className="drawer-footer">
              {!hasOfflineAccess ? (
                <button
                  type="button"
                  className="favorites-pass-btn"
                  onClick={() => {
                    setShowFavorites(false)
                    openPassOffer(
                      'See what Offline Pass includes — unlimited favorites + offline catalog.',
                    )
                  }}
                >
                  Get Offline Pass
                </button>
              ) : null}
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

      {showQueue ? (
        <div className="drawer-overlay centered-overlay" onClick={() => setShowQueue(false)}>
          <div
            className="drawer-card centered-card queue-drawer"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="queue-title"
          >
            <div className="drawer-header">
              <div>
                <h2 id="queue-title">Tonight&apos;s Queue ({pendingQueue.length})</h2>
                <p>Songs for this session — reorder, sing, then mark done.</p>
              </div>
              <button type="button" className="close-drawer-btn" onClick={() => setShowQueue(false)}>
                ✕
              </button>
            </div>
            <div className="drawer-body">
              {pendingQueue.length === 0 && doneQueue.length === 0 ? (
                <p className="empty-drawer-msg">
                  Walang naka-queue. Tap <strong>+ Queue</strong> on any song.
                </p>
              ) : null}

              {pendingQueue.length > 0 ? (
                <>
                  <p className="queue-section-label">Up next</p>
                  <ul className="reserved-list queue-list">
                    {pendingQueue.map((song, index) => (
                      <li key={song.id} className="reserved-item queue-item">
                        <span className="queue-order">{index + 1}</span>
                        <span className="reserved-code">{song.platinum_number}</span>
                        <div className="reserved-details">
                          <strong>{song.title}</strong>
                          <small>{song.artist || 'Unknown artist'}</small>
                        </div>
                        <div className="queue-item-actions">
                          <button
                            type="button"
                            className="queue-move-btn"
                            disabled={index === 0}
                            aria-label="Move up"
                            onClick={() => setQueue(moveQueueItem(song.id, 'up'))}
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            className="queue-move-btn"
                            disabled={index === pendingQueue.length - 1}
                            aria-label="Move down"
                            onClick={() => setQueue(moveQueueItem(song.id, 'down'))}
                          >
                            ↓
                          </button>
                          <button
                            type="button"
                            className="queue-done-btn"
                            onClick={() => {
                              setQueue(markQueueDone(song.id))
                              showToast(`Done: ${song.title}`)
                            }}
                          >
                            Done
                          </button>
                          <button
                            type="button"
                            className="remove-item-btn"
                            aria-label="Remove from queue"
                            onClick={() => setQueue(removeFromQueue(song.id))}
                          >
                            ✕
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}

              {doneQueue.length > 0 ? (
                <>
                  <p className="queue-section-label queue-section-label-done">
                    Sung tonight ({doneQueue.length})
                  </p>
                  <ul className="reserved-list queue-list queue-list-done">
                    {doneQueue.map((song) => (
                      <li key={song.id} className="reserved-item queue-item is-done">
                        <span className="reserved-code">{song.platinum_number}</span>
                        <div className="reserved-details">
                          <strong>{song.title}</strong>
                          <small>{song.artist || 'Unknown artist'}</small>
                        </div>
                        <div className="queue-item-actions">
                          <button
                            type="button"
                            className="queue-undo-btn"
                            onClick={() => setQueue(markQueuePending(song.id))}
                          >
                            Undo
                          </button>
                          <button
                            type="button"
                            className="remove-item-btn"
                            aria-label="Remove from queue"
                            onClick={() => setQueue(removeFromQueue(song.id))}
                          >
                            ✕
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
            </div>
            <div className="drawer-footer">
              <button
                type="button"
                className="clear-all-btn"
                disabled={doneQueue.length === 0}
                onClick={() => {
                  setQueue(clearDoneQueue())
                  showToast('Cleared sung songs.')
                }}
              >
                Clear sung
              </button>
              <button
                type="button"
                className="clear-all-btn"
                disabled={queue.length === 0}
                onClick={() => {
                  setQueue(clearQueue())
                  showToast('Queue cleared.')
                }}
              >
                Clear all
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

      {showPass ? (
        <PassModal
          onClose={() => {
            setShowPass(false)
            setPassReason('')
            setPassNudgeCopy(null)
          }}
          reason={passReason}
          loggedIn={Boolean(account?.authenticated)}
          hasAccess={hasOfflineAccess}
          trialAvailable={Boolean(account?.subscription?.trial_available)}
          trialUsed={Boolean(account?.subscription?.trial_used)}
          kicker={passNudgeCopy?.kicker || ''}
          headline={passNudgeCopy?.headline || ''}
          lead={passNudgeCopy?.lead || ''}
          onGetPass={() => openAccountFromPass('register')}
          onLogin={() => openAccountFromPass('login')}
          onManage={() => openAccountFromPass('register')}
          onStartTrial={handleStartTrialFromPass}
        />
      ) : null}

      {showAccount ? (
        <AccountModal
          key={`account-${accountMode}-${resetToken ? 'reset' : ''}-${account?.authenticated ? 'in' : 'out'}`}
          onClose={() => {
            setShowAccount(false)
            setResetToken('')
          }}
          account={account}
          initialMode={accountMode}
          initialResetToken={resetToken}
          onAccountChange={(next) => {
            applyAccountState(next?.authenticated ? next : { authenticated: false }, {
              forceLocalRevoke: Boolean(next?.clear_offline_access),
            })
            if (next?.offline_access) {
              adminMe().then((me) => {
                if (me?.authenticated) applyAccountState(me, { announceExpiry: false })
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
