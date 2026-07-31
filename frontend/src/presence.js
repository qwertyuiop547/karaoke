const STORAGE_KEY = 'karaoke_visitor_key'

function makeKey() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID().replace(/-/g, '')
  }
  return `v${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
}

export function getVisitorKey() {
  try {
    let key = localStorage.getItem(STORAGE_KEY)
    if (!key || key.length < 8) {
      key = makeKey()
      localStorage.setItem(STORAGE_KEY, key)
    }
    return key
  } catch {
    return makeKey()
  }
}
