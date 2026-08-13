const QUEUE_KEY = 'platino_sing_queue_v1'

function readQueue() {
  try {
    const raw = localStorage.getItem(QUEUE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeQueue(list) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(list))
}

function songPayload(song) {
  return {
    id: song.id,
    title: song.title || '',
    artist: song.artist || '',
    platinum_number: song.platinum_number || '',
    language: song.language || '',
    status: 'pending',
    addedAt: new Date().toISOString(),
  }
}

export function getQueue() {
  return readQueue()
}

export function getPendingQueue() {
  return readQueue().filter((row) => row.status !== 'done')
}

export function getDoneQueue() {
  return readQueue().filter((row) => row.status === 'done')
}

export function countPending() {
  return getPendingQueue().length
}

export function isInQueue(songId) {
  return readQueue().some((row) => row.id === songId && row.status !== 'done')
}

/**
 * @returns {{ next: array, added: boolean, alreadyQueued?: boolean }}
 */
export function addToQueue(song) {
  const current = readQueue()
  if (current.some((row) => row.id === song.id && row.status !== 'done')) {
    return { next: current, added: false, alreadyQueued: true }
  }

  const revived = current.find((row) => row.id === song.id && row.status === 'done')
  let next
  if (revived) {
    next = current.map((row) =>
      row.id === song.id ? { ...row, status: 'pending', addedAt: new Date().toISOString() } : row,
    )
  } else {
    next = [...current, songPayload(song)]
  }
  writeQueue(next)
  return { next, added: true, alreadyQueued: false }
}

export function removeFromQueue(songId) {
  const next = readQueue().filter((row) => row.id !== songId)
  writeQueue(next)
  return next
}

export function moveQueueItem(songId, direction) {
  const current = readQueue()
  const pending = current.filter((row) => row.status !== 'done')
  const done = current.filter((row) => row.status === 'done')
  const index = pending.findIndex((row) => row.id === songId)
  if (index < 0) return current

  const target = direction === 'up' ? index - 1 : index + 1
  if (target < 0 || target >= pending.length) return current

  const reordered = [...pending]
  ;[reordered[index], reordered[target]] = [reordered[target], reordered[index]]
  const next = [...reordered, ...done]
  writeQueue(next)
  return next
}

export function markQueueDone(songId) {
  const next = readQueue().map((row) =>
    row.id === songId ? { ...row, status: 'done', doneAt: new Date().toISOString() } : row,
  )
  writeQueue(next)
  return next
}

export function markQueuePending(songId) {
  const next = readQueue().map((row) =>
    row.id === songId ? { ...row, status: 'pending', doneAt: null } : row,
  )
  writeQueue(next)
  return next
}

export function clearDoneQueue() {
  const next = readQueue().filter((row) => row.status !== 'done')
  writeQueue(next)
  return next
}

export function clearQueue() {
  writeQueue([])
  return []
}
