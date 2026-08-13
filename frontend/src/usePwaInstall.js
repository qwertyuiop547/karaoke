import { useEffect, useState } from 'react'

/** True when running as installed PWA (home screen / standalone). */
export function isAppInstalled() {
  if (typeof window === 'undefined') return false
  const standalone = window.matchMedia('(display-mode: standalone)').matches
  const iosStandalone = window.navigator.standalone === true
  return standalone || iosStandalone
}

export function isIosDevice() {
  if (typeof navigator === 'undefined') return false
  return /iphone|ipad|ipod/i.test(navigator.userAgent)
}

function readEarlyDeferredPrompt() {
  if (typeof window === 'undefined') return null
  return window.__PLATINO_DEFERRED_INSTALL__ || null
}

/**
 * Captures the browser install prompt and exposes install helpers.
 * Pair with early listener in main.jsx — beforeinstallprompt only fires once.
 */
export function usePwaInstall() {
  const [deferred, setDeferred] = useState(() => readEarlyDeferredPrompt())
  const [installed, setInstalled] = useState(() => isAppInstalled())
  const [ios, setIos] = useState(() => isIosDevice())

  useEffect(() => {
    setInstalled(isAppInstalled())
    setIos(isIosDevice())

    const early = readEarlyDeferredPrompt()
    if (early) setDeferred(early)

    const onBeforeInstall = (event) => {
      event.preventDefault()
      window.__PLATINO_DEFERRED_INSTALL__ = event
      setDeferred(event)
    }
    const onInstalled = () => {
      window.__PLATINO_DEFERRED_INSTALL__ = null
      setDeferred(null)
      setInstalled(true)
    }

    window.addEventListener('beforeinstallprompt', onBeforeInstall)
    window.addEventListener('appinstalled', onInstalled)
    const onEarly = () => setDeferred(readEarlyDeferredPrompt())
    window.addEventListener('platino-beforeinstallprompt', onEarly)
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall)
      window.removeEventListener('appinstalled', onInstalled)
      window.removeEventListener('platino-beforeinstallprompt', onEarly)
    }
  }, [])

  const canPromptInstall = Boolean(deferred) && !installed

  const promptInstall = async () => {
    const event = deferred || readEarlyDeferredPrompt()
    if (!event) return { ok: false, reason: 'unavailable' }
    try {
      event.prompt()
      const choice = await event.userChoice
      window.__PLATINO_DEFERRED_INSTALL__ = null
      setDeferred(null)
      if (choice.outcome === 'accepted') {
        setInstalled(true)
        return { ok: true }
      }
      return { ok: false, reason: 'dismissed' }
    } catch {
      return { ok: false, reason: 'error' }
    }
  }

  return {
    installed,
    ios,
    canPromptInstall,
    promptInstall,
  }
}
