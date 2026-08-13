const DB_NAME = 'platino_offline_db'
const STORE = 'songs'
const META_KEY = 'platino_offline_meta'
/** ISO timestamp — local Pass window so expired trials can't keep using IndexedDB offline. */
const ACCESS_UNTIL_KEY = 'platino_offline_access_until'
/** After Pass expires offline, allow read-only catalog search for this window. */
const GRACE_UNTIL_KEY = 'platino_offline_grace_until'
export const OFFLINE_GRACE_PERIOD_MS = 24 * 60 * 60 * 1000
const BATCH_SIZE = 400

/** Re-check server catalog at most every 6 hours (If-None-Match makes it cheap). */
export const OFFLINE_AUTO_SYNC_MAX_AGE_MS = 6 * 60 * 60 * 1000

/** In-memory cache so mobile search doesn't getAll() from IndexedDB every keystroke. */
let catalogCache = null

/** Common karaoke nicknames / alternate spellings → canonical search text. */
const QUERY_ALIASES = {
  eheads: 'eraserheads',
  'eraser heads': 'eraserheads',
  'e heads': 'eraserheads',
  rivermaya: 'rivermaya',
  'river maya': 'rivermaya',
  'parokya ni edgar': 'parokya ni edgar',
  parokya: 'parokya ni edgar',
  pne: 'parokya ni edgar',
  'ben&ben': 'ben and ben',
  'ben and ben': 'ben and ben',
  benben: 'ben and ben',
  sb19: 'sb19',
  bini: 'bini',
  'gloc 9': 'gloc-9',
  gloc9: 'gloc-9',
  'hale band': 'hale',
  'the beatles': 'beatles',
  beatles: 'beatles',
  'queen band': 'queen',
  'backstreet boys': 'backstreet boys',
  bsb: 'backstreet boys',
  'westlife': 'westlife',
  'mariah carey': 'mariah carey',
  mariah: 'mariah carey',
  'celine dion': 'celine dion',
  'whitney houston': 'whitney houston',
  whitney: 'whitney houston',
  'bruno mars': 'bruno mars',
  'taylor swift': 'taylor swift',
  'ed sheeran': 'ed sheeran',
  'ariana grande': 'ariana grande',
  'justin bieber': 'justin bieber',
  'the weeknd': 'the weeknd',
  weeknd: 'the weeknd',
  'bohemian rhaposody': 'bohemian rhapsody',
  'bohemian rapsody': 'bohemian rhapsody',
  'bohemean rhapsody': 'bohemian rhapsody',
  'my way frank': 'my way',
  'wonder wall': 'wonderwall',
  'dont stop believin': 'dont stop believing',
  'dont stop believing': 'dont stop believing',
}

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

function stripEtag(etag) {
  if (!etag) return null
  return String(etag).trim().replace(/^W\//i, '').replace(/^"|"$/g, '') || null
}

export function getOfflineMeta() {
  try {
    const raw = localStorage.getItem(META_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function writeOfflineMeta(meta) {
  localStorage.setItem(META_KEY, JSON.stringify(meta))
  return meta
}

/** Persist Pass end time so offline mode stops when trial/subscription expires. */
export function setOfflineAccessUntil(isoOrNull) {
  try {
    if (!isoOrNull) {
      localStorage.removeItem(ACCESS_UNTIL_KEY)
      return null
    }
    localStorage.setItem(ACCESS_UNTIL_KEY, String(isoOrNull))
    return String(isoOrNull)
  } catch {
    return null
  }
}

export function getOfflineAccessUntil() {
  try {
    return localStorage.getItem(ACCESS_UNTIL_KEY) || null
  } catch {
    return null
  }
}

/** True while the locally stored Pass window is still open. */
export function hasLocalOfflineAccess(now = Date.now()) {
  const until = getOfflineAccessUntil()
  if (!until) return false
  const ms = new Date(until).getTime()
  return Number.isFinite(ms) && ms > now
}

export function getOfflineGraceUntil() {
  try {
    return localStorage.getItem(GRACE_UNTIL_KEY) || null
  } catch {
    return null
  }
}

/** Start or extend offline grace after Pass expires with no network. */
export function startOfflineGracePeriod(now = Date.now()) {
  const until = new Date(now + OFFLINE_GRACE_PERIOD_MS).toISOString()
  try {
    localStorage.setItem(GRACE_UNTIL_KEY, until)
  } catch {
    /* ignore */
  }
  return until
}

export function clearOfflineGrace() {
  try {
    localStorage.removeItem(GRACE_UNTIL_KEY)
  } catch {
    /* ignore */
  }
}

/** True during the post-expiry offline grace window. */
export function hasOfflineGraceAccess(now = Date.now()) {
  const until = getOfflineGraceUntil()
  if (!until) return false
  const ms = new Date(until).getTime()
  return Number.isFinite(ms) && ms > now
}

/**
 * @returns {'active' | 'grace' | 'none'}
 */
export function getOfflineAccessMode(now = Date.now()) {
  if (hasLocalOfflineAccess(now)) return 'active'
  if (hasOfflineGraceAccess(now)) return 'grace'
  return 'none'
}

/** Human-readable toast for catalog sync diffs. */
export function formatCatalogChangelog(changelog, totalCount) {
  if (!changelog) return null
  const parts = []
  if (changelog.added > 0) parts.push(`${changelog.added.toLocaleString()} new`)
  if (changelog.removed > 0) parts.push(`${changelog.removed.toLocaleString()} removed`)
  if (!parts.length) return null
  const total = Number.isFinite(totalCount) ? totalCount.toLocaleString() : String(totalCount || '')
  return `Catalog updated · ${parts.join(', ')} · ${total} songs total`
}

/**
 * Wipe IndexedDB catalog + meta. Call when trial ends / free plan / logout.
 * Offline search must not keep working after Pass expires.
 */
export async function clearOfflineCatalog() {
  catalogCache = null
  try {
    localStorage.removeItem(META_KEY)
  } catch {
    /* ignore */
  }
  try {
    localStorage.removeItem(ACCESS_UNTIL_KEY)
  } catch {
    /* ignore */
  }
  clearOfflineGrace()

  try {
    const db = await openDb()
    try {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).clear()
      await txDone(tx)
    } finally {
      db.close()
    }
  } catch {
    /* IndexedDB may be unavailable in private mode — meta already cleared */
  }

  return null
}

/** True when an existing offline pack should quietly re-check the server. */
export function needsOfflineAutoSync(
  meta = getOfflineMeta(),
  { maxAgeMs = OFFLINE_AUTO_SYNC_MAX_AGE_MS } = {},
) {
  if (!meta?.count) return false
  if (!meta.etag) return true
  const stamp = meta.checkedAt || meta.savedAt
  if (!stamp) return true
  const age = Date.now() - new Date(stamp).getTime()
  return !Number.isFinite(age) || age < 0 || age >= maxAgeMs
}

/** Mark a successful 304 / freshness probe without rewriting IndexedDB. */
export function touchOfflineChecked({ etag } = {}) {
  const prev = getOfflineMeta() || {}
  const next = {
    ...prev,
    checkedAt: new Date().toISOString(),
  }
  const clean = stripEtag(etag)
  if (clean) next.etag = clean
  return writeOfflineMeta(next)
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

export async function saveOfflineCatalog(songs, { etag } = {}) {
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

  let prevNumbers = new Set()
  try {
    const prev = await loadCatalogCached()
    prevNumbers = new Set(prev.map((row) => row.platinum_number).filter(Boolean))
  } catch {
    prevNumbers = new Set()
  }

  const newNumbers = new Set(normalized.map((row) => row.platinum_number).filter(Boolean))
  let added = 0
  let removed = 0
  for (const number of newNumbers) {
    if (!prevNumbers.has(number)) added += 1
  }
  for (const number of prevNumbers) {
    if (!newNumbers.has(number)) removed += 1
  }
  const changelog =
    prevNumbers.size > 0 && (added > 0 || removed > 0) ? { added, removed } : null

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

  const now = new Date().toISOString()
  const meta = {
    count: normalized.length,
    savedAt: now,
    checkedAt: now,
    etag: stripEtag(etag) || getOfflineMeta()?.etag || null,
    changelog: changelog
      ? {
          ...changelog,
          at: now,
        }
      : null,
  }
  writeOfflineMeta(meta)
  catalogCache = normalized
  clearOfflineGrace()
  return { meta, changelog }
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

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function expandQueryVariants(raw) {
  const base = normalizeText(raw)
  if (!base) return []

  const variants = new Set([base])

  const aliasHit = QUERY_ALIASES[base]
  if (aliasHit) variants.add(normalizeText(aliasHit))

  for (const [alias, canonical] of Object.entries(QUERY_ALIASES)) {
    if (base === alias) continue
    if (base.includes(alias)) {
      variants.add(normalizeText(base.split(alias).join(canonical)))
    }
  }

  // Drop doubled letters once (bohemiaan → bohemian-ish help for mild typos)
  if (/([a-z])\1/.test(base)) {
    variants.add(base.replace(/([a-z])\1+/g, '$1'))
  }

  return [...variants]
}

function maxEditDistance(len) {
  if (len <= 3) return 0
  if (len <= 5) return 1
  if (len <= 9) return 2
  return 3
}

function levenshtein(a, b, maxDist) {
  if (a === b) return 0
  const la = a.length
  const lb = b.length
  if (Math.abs(la - lb) > maxDist) return maxDist + 1
  if (!la) return lb
  if (!lb) return la

  let prev = new Array(lb + 1)
  let curr = new Array(lb + 1)
  for (let j = 0; j <= lb; j += 1) prev[j] = j

  for (let i = 1; i <= la; i += 1) {
    curr[0] = i
    let rowMin = curr[0]
    const ca = a.charCodeAt(i - 1)
    for (let j = 1; j <= lb; j += 1) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1
      const val = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost)
      curr[j] = val
      if (val < rowMin) rowMin = val
    }
    if (rowMin > maxDist) return maxDist + 1
    ;[prev, curr] = [curr, prev]
  }
  return prev[lb]
}

function bestTokenDistance(token, words, maxDist) {
  let best = maxDist + 1
  for (const word of words) {
    if (!word) continue
    if (word.startsWith(token) || token.startsWith(word)) {
      return 0
    }
    const d = levenshtein(token, word, maxDist)
    if (d < best) best = d
    if (best === 0) return 0
  }
  return best
}

function scoreSongAgainstQuery(song, queryVariants, digitsOnly) {
  const title = normalizeText(song.title)
  const artist = normalizeText(song.artist)
  const number = String(song.platinum_number || '').toLowerCase()
  const hay = `${title} ${artist} ${number}`
  const titleWords = title.split(' ').filter(Boolean)
  const artistWords = artist.split(' ').filter(Boolean)
  const words = [...titleWords, ...artistWords]

  let best = 0

  if (digitsOnly) {
    if (number === digitsOnly) best = Math.max(best, 120)
    else if (number.startsWith(digitsOnly)) best = Math.max(best, 100)
    else if (number.includes(digitsOnly)) best = Math.max(best, 70)
  }

  for (const q of queryVariants) {
    if (!q) continue

    if (hay.includes(q)) {
      best = Math.max(best, title.startsWith(q) || artist.startsWith(q) ? 110 : 100)
      continue
    }

    const tokens = q.split(' ').filter(Boolean)
    if (!tokens.length) continue

    let tokenScore = 0
    let matched = 0
    for (const token of tokens) {
      const maxDist = maxEditDistance(token.length)
      if (hay.includes(token)) {
        matched += 1
        tokenScore += 28
        continue
      }
      const dist = bestTokenDistance(token, words, maxDist)
      if (dist <= maxDist) {
        matched += 1
        tokenScore += Math.max(8, 24 - dist * 8)
      }
    }

    if (matched === tokens.length) {
      best = Math.max(best, 55 + tokenScore)
    } else if (matched > 0 && matched >= Math.ceil(tokens.length * 0.6)) {
      best = Math.max(best, 25 + tokenScore)
    }
  }

  return best
}

export async function searchOfflineCatalog(
  query,
  { letter = 'ALL', category = 'ALL', page = 1, pageSize = 10 } = {},
) {
  const all = await loadCatalogCached()

  const raw = query.trim()
  const queryVariants = expandQueryVariants(raw)
  const digitsOnly = /^\d+$/.test(raw.trim()) ? raw.trim() : ''

  let scored = all.map((song) => {
    let score = 0
    if (queryVariants.length) {
      score = scoreSongAgainstQuery(song, queryVariants, digitsOnly)
    } else {
      score = 1
    }
    return { song, score }
  })

  if (queryVariants.length) {
    scored = scored.filter((row) => row.score > 0)
  }

  if (letter && letter !== 'ALL') {
    scored = scored.filter((row) => (row.song.title || '').toUpperCase().startsWith(letter))
  }

  if (category === 'OPM') {
    scored = scored.filter(
      (row) =>
        (row.song.language || '').toLowerCase() === 'filipino' ||
        (row.song.genre || '').toLowerCase() === 'opm',
    )
  } else if (category === 'ENGLISH') {
    scored = scored.filter((row) => (row.song.language || '').toLowerCase() === 'english')
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    return (a.song.title || '').localeCompare(b.song.title || '')
  })

  const filtered = scored.map((row) => row.song)
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
