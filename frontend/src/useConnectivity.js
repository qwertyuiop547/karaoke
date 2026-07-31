import { useCallback, useEffect, useRef, useState } from 'react'
import { isOnline as readNavigatorOnline } from './offline'

const DEFAULT_PROBE = `${import.meta.env.VITE_API_URL || '/api'}/auth/csrf/`

/**
 * Reliable online/offline for installed PWAs.
 * navigator.onLine alone is flaky on mobile — we also probe the network
 * on mount, when the app resumes, and on a short interval.
 */
export function useConnectivity({
  probeUrl = DEFAULT_PROBE,
  intervalMs = 20000,
  timeoutMs = 4000,
} = {}) {
  const [online, setOnline] = useState(() => readNavigatorOnline())
  const onlineRef = useRef(online)
  const probingRef = useRef(false)

  useEffect(() => {
    onlineRef.current = online
  }, [online])

  const probe = useCallback(async () => {
    if (probingRef.current) return onlineRef.current
    probingRef.current = true
    try {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
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
          credentials: 'include',
          signal: controller.signal,
        })
        // Any reachable server response means we have a network path.
        const ok = response.status > 0
        if (onlineRef.current !== ok) setOnline(ok)
        return ok
      } catch {
        if (onlineRef.current) setOnline(false)
        return false
      } finally {
        window.clearTimeout(timer)
      }
    } finally {
      probingRef.current = false
    }
  }, [probeUrl, timeoutMs])

  useEffect(() => {
    probe()

    const goOffline = () => setOnline(false)
    const goOnline = () => {
      probe()
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') probe()
    }

    window.addEventListener('offline', goOffline)
    window.addEventListener('online', goOnline)
    window.addEventListener('focus', goOnline)
    document.addEventListener('visibilitychange', onVisibility)

    const interval = window.setInterval(probe, Math.max(8000, intervalMs))

    return () => {
      window.removeEventListener('offline', goOffline)
      window.removeEventListener('online', goOnline)
      window.removeEventListener('focus', goOnline)
      document.removeEventListener('visibilitychange', onVisibility)
      window.clearInterval(interval)
    }
  }, [probe, intervalMs])

  return { online, checkConnectivity: probe }
}
