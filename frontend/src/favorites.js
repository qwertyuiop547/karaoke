const FAVORITES_KEY = 'platino_favorites_v1'

/** Free saves without Offline Pass. Pass unlocks unlimited favorites. */
export const FREE_FAVORITE_LIMIT = 10

function readFavorites() {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeFavorites(list) {
  localStorage.setItem(FAVORITES_KEY, JSON.stringify(list))
}

export function getFavorites() {
  return readFavorites()
}

export function isFavorite(songId) {
  return readFavorites().some((s) => s.id === songId)
}

/**
 * @param {object} song
 * @param {{ unlimited?: boolean }} [options]
 * @returns {{ next: array, added: boolean, blocked?: boolean, limit?: number }}
 */
export function toggleFavorite(song, { unlimited = false } = {}) {
  const current = readFavorites()
  const exists = current.some((s) => s.id === song.id)

  if (!exists && !unlimited && current.length >= FREE_FAVORITE_LIMIT) {
    return {
      next: current,
      added: false,
      blocked: true,
      limit: FREE_FAVORITE_LIMIT,
    }
  }

  const next = exists
    ? current.filter((s) => s.id !== song.id)
    : [
        {
          id: song.id,
          title: song.title,
          artist: song.artist,
          platinum_number: song.platinum_number,
          language: song.language || '',
        },
        ...current,
      ]
  writeFavorites(next)
  return { next, added: !exists, blocked: false }
}

export function removeFavorite(songId) {
  const next = readFavorites().filter((s) => s.id !== songId)
  writeFavorites(next)
  return next
}

export function clearFavorites() {
  writeFavorites([])
  return []
}
