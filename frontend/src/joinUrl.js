const JOIN_URL_KEY = 'karaoke-join-url'

export function defaultJoinUrl() {
  const url = new URL(window.location.href)
  url.hash = ''
  url.search = ''
  url.pathname = url.pathname.replace(/\/index\.html$/i, '/') || '/'
  url.searchParams.set('join', '1')
  return url.toString()
}

export function loadJoinUrl() {
  try {
    const saved = localStorage.getItem(JOIN_URL_KEY)
    if (saved && /^https?:\/\//i.test(saved)) return saved
  } catch {
    // ignore
  }
  return defaultJoinUrl()
}

export function saveJoinUrl(value) {
  try {
    localStorage.setItem(JOIN_URL_KEY, value)
  } catch {
    // ignore
  }
}

const REFERRAL_CODE_KEY = 'platino_referral_code'

export function getSavedReferralCode() {
  try {
    return localStorage.getItem(REFERRAL_CODE_KEY) || ''
  } catch {
    return ''
  }
}

export function saveReferralCode(code) {
  try {
    if (code) {
      localStorage.setItem(REFERRAL_CODE_KEY, code.toUpperCase().trim())
    }
  } catch {
    // ignore
  }
}

/** True when opened from a QR / join poster link. */
export function consumeJoinParam() {
  const url = new URL(window.location.href)
  if (url.searchParams.get('join') !== '1') return false
  url.searchParams.delete('join')
  const next = `${url.pathname}${url.search}${url.hash}`
  window.history.replaceState(null, '', next || '/')
  return true
}

/** Capture ?ref=CODE from URL and save in localStorage for signup. */
export function consumeReferralParam() {
  try {
    const url = new URL(window.location.href)
    const ref = (url.searchParams.get('ref') || url.searchParams.get('referral') || '').trim()
    if (ref) {
      saveReferralCode(ref)
      url.searchParams.delete('ref')
      url.searchParams.delete('referral')
      const next = `${url.pathname}${url.search}${url.hash}`
      window.history.replaceState(null, '', next || '/')
      return ref
    }
  } catch {
    // ignore
  }
  return getSavedReferralCode()
}
