import { useEffect, useRef, useState } from 'react'
import { googleAuthLogin } from './api'

const GOOGLE_CLIENT_ID =
  import.meta.env.VITE_GOOGLE_CLIENT_ID ||
  window.GOOGLE_CLIENT_ID ||
  '1041809515809-on1uu7s1mevgu4ppnjpi7nrsk0opj94u.apps.googleusercontent.com'

export default function GoogleAuthButton({
  onSuccess,
  onError,
  referralCode = '',
  disabled = false,
  text = 'Continue with Google',
}) {
  const [loading, setLoading] = useState(false)
  const containerRef = useRef(null)

  const handleCredential = async (credential) => {
    if (!credential) return
    setLoading(true)
    try {
      const next = await googleAuthLogin({
        credential,
        referralCode,
      })
      onSuccess?.(next)
    } catch (err) {
      onError?.(err.message || 'Google sign-in failed.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return

    let resizeTimer = null

    const renderGoogleBtn = () => {
      if (!window.google?.accounts?.id || !containerRef.current) return

      try {
        window.google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: (response) => {
            if (response?.credential) {
              handleCredential(response.credential)
            } else {
              onError?.('Google sign-in did not return credentials.')
            }
          },
          auto_select: false,
          cancel_on_tap_outside: true,
        })

        // Measure container width for 100% mobile and desktop responsiveness
        const measuredWidth = containerRef.current.clientWidth || 300
        const computedWidth = Math.min(Math.max(Math.floor(measuredWidth), 200), 400)

        containerRef.current.innerHTML = ''
        window.google.accounts.id.renderButton(containerRef.current, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          text: text === 'Sign up with Google' ? 'signup_with' : 'continue_with',
          shape: 'rectangular',
          logo_alignment: 'left',
          width: computedWidth,
        })
      } catch (err) {
        console.warn('Error rendering Google button:', err)
      }
    }

    if (window.google?.accounts?.id) {
      renderGoogleBtn()
    } else {
      const script = document.createElement('script')
      script.src = 'https://accounts.google.com/gsi/client'
      script.async = true
      script.defer = true
      script.onload = renderGoogleBtn
      document.head.appendChild(script)
    }

    // Auto-adapt to mobile orientation or viewport resize
    const handleResize = () => {
      window.clearTimeout(resizeTimer)
      resizeTimer = window.setTimeout(renderGoogleBtn, 120)
    }

    window.addEventListener('resize', handleResize)

    let observer = null
    if (typeof ResizeObserver !== 'undefined' && containerRef.current) {
      observer = new ResizeObserver(() => {
        handleResize()
      })
      observer.observe(containerRef.current)
    }

    return () => {
      window.clearTimeout(resizeTimer)
      window.removeEventListener('resize', handleResize)
      if (observer) observer.disconnect()
    }
  }, [onSuccess, onError, referralCode, text])

  return (
    <div className="google-auth-container-wrapper">
      {loading ? (
        <div className="google-auth-loading">Connecting to Google…</div>
      ) : null}
      <div
        ref={containerRef}
        className="google-rendered-button"
        style={{ display: loading ? 'none' : 'flex' }}
      />
    </div>
  )
}
