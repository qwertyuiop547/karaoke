const DEVICE_KEY = 'platino_device_id_v1'

function randomId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return `d_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`
}

/** Stable per-install device id for trial anti-abuse. */
export function getDeviceId() {
  try {
    let id = localStorage.getItem(DEVICE_KEY)
    if (!id || id.length < 8) {
      id = randomId()
      localStorage.setItem(DEVICE_KEY, id)
    }
    return id
  } catch {
    return randomId()
  }
}
