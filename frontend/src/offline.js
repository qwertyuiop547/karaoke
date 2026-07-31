const DB_NAME = 'platino_offline_db'
const STORE = 'songs'
const META_KEY = 'platino_offline_meta'
const BATCH_SIZE = 400

/** In-memory cache so mobile search doesn't getAll() from IndexedDB every keystroke. */
let catalogCache = null

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' })
        store.createIndex('title', 'title', { unique: false })
        store.createIndex('artist', 'artist', { unique: false })
        store.createIndex('platinum_number', 'platinum_number', { unique: false })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error || new Error('IndexedDB transaction failed.'))
    tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted.'))
  })
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export function getOfflineMeta() {
  try {
    const raw = localStorage.getItem(META_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export async function countOfflineSongs() {
  const db = await openDb()
  try {
    const tx = db.transaction(STORE, 'readonly')
    const store = tx.objectStore(STORE)
    const count = await requestToPromise(store.count())
    await txDone(tx)
    return count
  } finally {
    db.close()
  }
}

export async function saveOfflineCatalog(songs) {
  if (!Array.isArray(songs) || songs.length === 0) {
    throw new Error('Offline pack was empty. Try again while online.')
  }

  const normalized = songs
    .filter((s) => s && s.id != null)
    .map((s) => ({
      id: s.id,
      title: s.title || '',
      artist: s.artist || '',
      platinum_number: s.platinum_number || '',
      language: s.language || '',
      genre: s.genre || '',
    }))

  if (!normalized.length) {
    throw new Error('Offline pack had no usable songs.')
  }

  const db = await openDb()
  try {
    const clearTx = db.transaction(STORE, 'readwrite')
    clearTx.objectStore(STORE).clear()
    await txDone(clearTx)

    for (let i = 0; i < normalized.length; i += BATCH_SIZE) {
      const chunk = normalized.slice(i, i + BATCH_SIZE)
      const tx = db.transaction(STORE, 'readwrite')
      const store = tx.objectStore(STORE)
      for (const song of chunk) {
        store.put(song)
      }
      await txDone(tx)
    }

    const verifyTx = db.transaction(STORE, 'readonly')
    const stored = await requestToPromise(verifyTx.objectStore(STORE).count())
    await txDone(verifyTx)

    if (stored < normalized.length) {
      throw new Error(
        `Offline save incomplete (${stored.toLocaleString()} / ${normalized.length.toLocaleString()}). Try again.`,
      )
    }
  } finally {
    db.close()
  }

  const meta = {
    count: normalized.length,
    savedAt: new Date().toISOString(),
  }
  localStorage.setItem(META_KEY, JSON.stringify(meta))
  catalogCache = normalized
  return meta
}

async function loadCatalogCached() {
  if (Array.isArray(catalogCache)) return catalogCache
  const db = await openDb()
  try {
    const tx = db.transaction(STORE, 'readonly')
    const store = tx.objectStore(STORE)
    catalogCache = (await requestToPromise(store.getAll())) || []
    await txDone(tx)
  } finally {
    db.close()
  }
  return catalogCache
}

export async function searchOfflineCatalog(
  query,
  { letter = 'ALL', category = 'ALL', page = 1, pageSize = 10 } = {},
) {
  const all = await loadCatalogCached()

  const q = query.trim().toLowerCase()
  let filtered = all

  if (q) {
    filtered = filtered.filter((s) => {
      const hay = `${s.title} ${s.artist} ${s.platinum_number}`.toLowerCase()
      return hay.includes(q)
    })
  }

  if (letter && letter !== 'ALL') {
    filtered = filtered.filter((s) => (s.title || '').toUpperCase().startsWith(letter))
  }

  if (category === 'OPM') {
    filtered = filtered.filter(
      (s) =>
        (s.language || '').toLowerCase() === 'filipino' ||
        (s.genre || '').toLowerCase() === 'opm',
    )
  } else if (category === 'ENGLISH') {
    filtered = filtered.filter((s) => (s.language || '').toLowerCase() === 'english')
  }

  filtered.sort((a, b) => (a.title || '').localeCompare(b.title || ''))

  const start = (page - 1) * pageSize
  const results = filtered.slice(start, start + pageSize)
  const hasMore = start + pageSize < filtered.length

  return {
    count: filtered.length,
    results,
    next: hasMore ? true : null,
    offline: true,
  }
}

export function isOnline() {
  return typeof navigator !== 'undefined' ? navigator.onLine : true
}
