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

/**
 * Captures the browser install prompt and exposes install helpers.
 */
export function usePwaInstall() {
  const [deferred, setDeferred] = useState(null)
  const [installed, setInstalled] = useState(() => isAppInstalled())
  const [ios, setIos] = useState(() => isIosDevice())

  useEffect(() => {
    setInstalled(isAppInstalled())
    setIos(isIosDevice())

    const onBeforeInstall = (event) => {
      event.preventDefault()
      setDeferred(event)
    }
    const onInstalled = () => {
      setDeferred(null)
      setInstalled(true)
    }

    window.addEventListener('beforeinstallprompt', onBeforeInstall)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  const canPromptInstall = Boolean(deferred) && !installed

  const promptInstall = async () => {
    if (!deferred) return { ok: false, reason: 'unavailable' }
    deferred.prompt()
    const choice = await deferred.userChoice
    setDeferred(null)
    if (choice.outcome === 'accepted') {
      setInstalled(true)
      return { ok: true }
    }
    return { ok: false, reason: 'dismissed' }
  }

  return {
    installed,
    ios,
    canPromptInstall,
    promptInstall,
  }
}
