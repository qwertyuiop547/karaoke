import { useEffect, useRef, useState } from 'react'
import { googleAuthLogin } from './api'

const GOOGLE_CLIENT_ID =
  import.meta.env.VITE_GOOGLE_CLIENT_ID ||
  window.GOOGLE_CLIENT_ID ||
  ''

export default function GoogleAuthButton({
  onSuccess,
  onError,
  referralCode = '',
  disabled = false,
  text = 'Continue with Google',
}) {
  const [loading, setLoading] = useState(false)
  const gisContainerRef = useRef(null)

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return

    const handleCredentialResponse = async (response) => {
      if (!response?.credential) return
      setLoading(true)
      try {
        const next = await googleAuthLogin({
          credential: response.credential,
          referralCode,
        })
        onSuccess?.(next)
      } catch (err) {
        onError?.(err.message || 'Google sign-in failed.')
      } finally {
        setLoading(false)
      }
    }

    const initGis = () => {
      if (!window.google?.accounts?.id) return
      try {
        window.google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: handleCredentialResponse,
          auto_select: false,
          cancel_on_tap_outside: true,
        })

        if (gisContainerRef.current) {
          gisContainerRef.current.innerHTML = ''
          window.google.accounts.id.renderButton(gisContainerRef.current, {
            theme: 'filled_blue',
            size: 'large',
            type: 'standard',
            text: text === 'Sign up with Google' ? 'signup_with' : 'continue_with',
            shape: 'rectangular',
            logo_alignment: 'left',
            width: 320,
          })
        }
      } catch (err) {
        console.warn('Could not initialize Google Identity Services:', err)
      }
    }

    if (window.google?.accounts?.id) {
      initGis()
    } else {
      const script = document.createElement('script')
      script.src = 'https://accounts.google.com/gsi/client'
      script.async = true
      script.defer = true
      script.onload = initGis
      document.head.appendChild(script)
    }
  }, [onSuccess, onError, referralCode, text])

  const handleClick = async () => {
    if (disabled || loading) return

    if (!GOOGLE_CLIENT_ID) {
      onError?.(
        'Google OAuth is not yet configured. Please set GOOGLE_CLIENT_ID and VITE_GOOGLE_CLIENT_ID in Railway Variables.',
      )
      return
    }

    if (window.google?.accounts?.id) {
      try {
        window.google.accounts.id.prompt()
      } catch {
        // Fallback
      }
    }
  }

  return (
    <div className="google-auth-wrapper">
      <div ref={gisContainerRef} className="google-gis-container" />
      <button
        type="button"
        className="google-auth-btn"
        onClick={handleClick}
        disabled={disabled || loading}
        aria-label={text}
      >
        <svg className="google-icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path
            fill="#4285F4"
            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
          />
          <path
            fill="#34A853"
            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
          />
          <path
            fill="#FBBC05"
            d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
          />
          <path
            fill="#EA4335"
            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
          />
        </svg>
        <span>{loading ? 'Connecting to Google…' : text}</span>
      </button>
    </div>
  )
}
