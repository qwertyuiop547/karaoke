import { useEffect } from 'react'
import { pingPresence } from './api'
import { getVisitorKey } from './presence'

/** Shared throttle so Strict Mode / remounts / multiple hooks don't stampede the API. */
const MIN_GAP_MS = 45000
let lastPingAt = 0
let lastPingPath = ''
let inFlight = null

async function throttledPing({ visitorKey, path }) {
  const now = Date.now()
  const samePath = path === lastPingPath
  if (samePath && now - lastPingAt < MIN_GAP_MS) return null
  if (inFlight) return inFlight

  lastPingAt = now
  lastPingPath = path
  inFlight = pingPresence({ visitorKey, path })
    .catch(() => null)
    .finally(() => {
      inFlight = null
    })
  return inFlight
}

/** Send heartbeat so admin can see active visitors. */
export function usePresencePing(path = 'songbook', intervalMs = 60000) {
  useEffect(() => {
    let cancelled = false
    const visitorKey = getVisitorKey()

    const beat = () => {
      if (cancelled || !navigator.onLine) return
      throttledPing({ visitorKey, path })
    }

    beat()
    const timer = window.setInterval(beat, Math.max(intervalMs, MIN_GAP_MS))

    const onVisible = () => {
      if (document.visibilityState === 'visible') beat()
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      cancelled = true
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [path, intervalMs])
}
