import { useCallback, useEffect, useRef, useState } from 'react'
import { isOnline as readNavigatorOnline } from './offline'

/** Lightweight endpoint — no CSRF cookie work, no DB. */
const DEFAULT_PROBE = `${import.meta.env.VITE_API_URL || '/api'}/health/`

/**
 * Online/offline for PWAs.
 * Wi‑Fi can be up while the API is slow — do NOT flip to Offline on a single
 * failed probe (that was marking phones "offline" with Wi‑Fi still on).
 */
export function useConnectivity({
  probeUrl = DEFAULT_PROBE,
  intervalMs = 60000,
  timeoutMs = 10000,
  failThreshold = 3,
} = {}) {
  const [online, setOnline] = useState(() => readNavigatorOnline())
  const onlineRef = useRef(online)
  const probingRef = useRef(false)
  const failStreakRef = useRef(0)

  useEffect(() => {
    onlineRef.current = online
  }, [online])

  const probe = useCallback(async () => {
    if (probingRef.current) return onlineRef.current
    probingRef.current = true
    try {
      // Device says no network at all.
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        failStreakRef.current = failThreshold
        if (onlineRef.current) setOnline(false)
        return false
      }

      const controller = new AbortController()
      const timer = window.setTimeout(() => controller.abort(), timeoutMs)
      try {
        const url = `${probeUrl}${probeUrl.includes('?') ? '&' : '?'}_=${Date.now()}`
        const response = await fetch(url, {
          method: 'GET',
          cache: 'no-store',
          credentials: 'omit',
          signal: controller.signal,
        })
        if (response.status > 0) {
          failStreakRef.current = 0
          if (!onlineRef.current) setOnline(true)
          return true
        }
        failStreakRef.current += 1
      } catch {
        // Slow/unreachable API ≠ no Wi‑Fi. Require a streak before Offline UI.
        failStreakRef.current += 1
      } finally {
        window.clearTimeout(timer)
      }

      if (failStreakRef.current >= failThreshold) {
        if (onlineRef.current) setOnline(false)
        return false
      }
      // Keep treating as online while Wi‑Fi is up and streak is below threshold.
      return onlineRef.current
    } finally {
      probingRef.current = false
    }
  }, [probeUrl, timeoutMs, failThreshold])

  useEffect(() => {
    probe()

    const goOffline = () => {
      failStreakRef.current = failThreshold
      setOnline(false)
    }
    const goOnline = () => {
      failStreakRef.current = 0
      setOnline(true)
      probe()
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') probe()
    }

    window.addEventListener('offline', goOffline)
    window.addEventListener('online', goOnline)
    window.addEventListener('focus', goOnline)
    document.addEventListener('visibilitychange', onVisibility)

    const interval = window.setInterval(probe, Math.max(30000, intervalMs))

    return () => {
      window.removeEventListener('offline', goOffline)
      window.removeEventListener('online', goOnline)
      window.removeEventListener('focus', goOnline)
      document.removeEventListener('visibilitychange', onVisibility)
      window.clearInterval(interval)
    }
  }, [probe, intervalMs, failThreshold])

  return { online, checkConnectivity: probe }
}
