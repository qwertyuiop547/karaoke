import { useEffect, useRef, useState } from 'react'
import { googleAuthLogin } from './api'

const GOOGLE_CLIENT_ID =
  import.meta.env.VITE_GOOGLE_CLIENT_ID ||
  window.GOOGLE_CLIENT_ID ||
  '1041809515809-on1uu7s1mevgu4ppnjpl7nrsk0opj94u.apps.googleusercontent.com'

export default function GoogleAuthButton({
  onSuccess,
  onError,
  referralCode = '',
  disabled = false,
  text = 'Continue with Google',
}) {
  const [loading, setLoading] = useState(false)
  const tokenClientRef = useRef(null)
  const gisInitializedRef = useRef(false)

  const handleCredential = async (token) => {
    if (!token) return
    setLoading(true)
    try {
      const next = await googleAuthLogin({
        credential: token,
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

    const initClients = () => {
      if (gisInitializedRef.current) return
      try {
        // 1. Initialize Google Identity Services (ID Token flow)
        if (window.google?.accounts?.id) {
          window.google.accounts.id.initialize({
            client_id: GOOGLE_CLIENT_ID,
            callback: (res) => {
              if (res?.credential) handleCredential(res.credential)
            },
            auto_select: false,
            cancel_on_tap_outside: true,
          })
        }

        // 2. Initialize OAuth2 Token Client (Explicit Popup flow)
        if (window.google?.accounts?.oauth2) {
          tokenClientRef.current = window.google.accounts.oauth2.initTokenClient({
            client_id: GOOGLE_CLIENT_ID,
            scope: 'email profile openid',
            callback: (tokenRes) => {
              if (tokenRes?.access_token) {
                handleCredential(tokenRes.access_token)
              } else if (tokenRes?.error) {
                onError?.(`Google sign-in: ${tokenRes.error}`)
              }
            },
            error_callback: (err) => {
              console.warn('Google OAuth TokenClient error:', err)
            },
          })
        }
        gisInitializedRef.current = true
      } catch (err) {
        console.warn('Could not initialize Google Identity Services:', err)
      }
    }

    if (window.google?.accounts?.id || window.google?.accounts?.oauth2) {
      initClients()
    } else {
      const script = document.createElement('script')
      script.src = 'https://accounts.google.com/gsi/client'
      script.async = true
      script.defer = true
      script.onload = initClients
      document.head.appendChild(script)
    }
  }, [onSuccess, onError, referralCode])

  const handleClick = async () => {
    if (disabled || loading) return

    if (!GOOGLE_CLIENT_ID) {
      onError?.('Google OAuth Client ID is not configured.')
      return
    }

    // A. Preferred: Use Google OAuth2 Token Client popup (guaranteed popup on click)
    try {
      if (window.google?.accounts?.oauth2) {
        const client =
          tokenClientRef.current ||
          window.google.accounts.oauth2.initTokenClient({
            client_id: GOOGLE_CLIENT_ID,
            scope: 'email profile openid',
            callback: (tokenRes) => {
              if (tokenRes?.access_token) {
                handleCredential(tokenRes.access_token)
              } else if (tokenRes?.error) {
                onError?.(`Google sign-in: ${tokenRes.error}`)
              }
            },
          })
        tokenClientRef.current = client
        client.requestAccessToken({ prompt: 'select_account' })
        return
      }
    } catch (err) {
      console.warn('TokenClient prompt failed, attempting fallback:', err)
    }

    // B. Fallback 1: Google One Tap prompt
    if (window.google?.accounts?.id) {
      try {
        window.google.accounts.id.prompt()
        return
      } catch (err) {
        console.warn('Google One Tap prompt failed:', err)
      }
    }

    // C. Fallback 2: Direct OAuth URL Popup
    try {
      const redirectUri = window.location.origin
      const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(
        GOOGLE_CLIENT_ID,
      )}&redirect_uri=${encodeURIComponent(
        redirectUri,
      )}&response_type=token&scope=${encodeURIComponent('email profile openid')}&prompt=select_account`
      window.open(authUrl, 'google_login_popup', 'width=500,height=600')
    } catch (err) {
      onError?.('Could not open Google Sign-In window.')
    }
  }

  return (
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
  )
}
