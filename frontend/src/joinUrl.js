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

/** True when opened from a QR / join poster link. */
export function consumeJoinParam() {
  const url = new URL(window.location.href)
  if (url.searchParams.get('join') !== '1') return false
  url.searchParams.delete('join')
  const next = `${url.pathname}${url.search}${url.hash}`
  window.history.replaceState(null, '', next || '/')
  return true
}
