const API_BASE = import.meta.env.VITE_API_URL || '/api'

let csrfPromise = null

function getCookie(name) {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`))
  return match ? decodeURIComponent(match[1]) : ''
}

async function csrfHeaders(extra = {}) {
  let csrf = getCookie('csrftoken')
  if (!csrf) {
    await fetchCsrf()
    csrf = getCookie('csrftoken')
  }
  return {
    ...(csrf ? { 'X-CSRFToken': csrf } : {}),
    ...extra,
  }
}

async function parseError(response, fallback) {
  const data = await response.json().catch(() => ({}))
  if (typeof data.detail === 'string') return data.detail
  if (Array.isArray(data.detail)) return data.detail[0]
  const firstField = Object.values(data).flat?.()?.[0]
  if (typeof firstField === 'string') return firstField
  return fallback
}

export async function fetchCsrf() {
  if (!csrfPromise) {
    csrfPromise = fetch(`${API_BASE}/auth/csrf/`, {
      credentials: 'include',
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error('Could not initialize login security token.')
        }
        return response.json()
      })
      .finally(() => {
        // Allow refresh later if cookie was cleared
        window.setTimeout(() => {
          csrfPromise = null
        }, 5 * 60 * 1000)
      })
  }
  return csrfPromise
}

export async function adminLogin(username, password) {
  const headers = await csrfHeaders({ 'Content-Type': 'application/json' })
  const response = await fetch(`${API_BASE}/auth/login/`, {
    method: 'POST',
    credentials: 'include',
    headers,
    body: JSON.stringify({ username, password }),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(data.detail || 'Invalid admin credentials.')
  }
  return data
}

export async function adminLogout() {
  const headers = await csrfHeaders({ 'Content-Type': 'application/json' })
  const response = await fetch(`${API_BASE}/auth/logout/`, {
    method: 'POST',
    credentials: 'include',
    headers,
    body: '{}',
  })
  if (!response.ok) {
    throw new Error('Could not sign out.')
  }
  return response.json()
}

export async function adminMe() {
  const response = await fetch(`${API_BASE}/auth/me/`, {
    credentials: 'include',
  })
  if (!response.ok) {
    return { authenticated: false }
  }
  return response.json()
}

export async function subscriberRegister({ email, password, confirmPassword }) {
  const headers = await csrfHeaders({ 'Content-Type': 'application/json' })
  const response = await fetch(`${API_BASE}/auth/register/`, {
    method: 'POST',
    credentials: 'include',
    headers,
    body: JSON.stringify({
      email,
      password,
      confirm_password: confirmPassword,
    }),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(data.detail || 'Could not create account.')
  }
  return data
}

export async function subscriberLogin(email, password) {
  const headers = await csrfHeaders({ 'Content-Type': 'application/json' })
  const response = await fetch(`${API_BASE}/auth/subscriber-login/`, {
    method: 'POST',
    credentials: 'include',
    headers,
    body: JSON.stringify({ email, password }),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(data.detail || 'Invalid email or password.')
  }
  return data
}

export async function subscriberLogout() {
  return adminLogout()
}

export async function createCheckoutSession() {
  const headers = await csrfHeaders({ 'Content-Type': 'application/json' })
  const response = await fetch(`${API_BASE}/billing/checkout/`, {
    method: 'POST',
    credentials: 'include',
    headers,
    body: '{}',
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const err = new Error(data.detail || 'Could not start checkout.')
    err.code = data.code
    throw err
  }
  return data
}

export async function createBillingPortalSession() {
  const headers = await csrfHeaders({ 'Content-Type': 'application/json' })
  const response = await fetch(`${API_BASE}/billing/portal/`, {
    method: 'POST',
    credentials: 'include',
    headers,
    body: '{}',
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(data.detail || 'Could not open billing portal.')
  }
  return data
}

export async function listSubscribers({ signal } = {}) {
  const response = await fetch(`${API_BASE}/billing/subscribers/`, {
    credentials: 'include',
    signal,
  })
  if (!response.ok) {
    throw new Error(await parseError(response, 'Could not load subscribers.'))
  }
  return response.json()
}

export async function adminActivateSubscriber({ email, userId, until }) {
  const headers = await csrfHeaders({ 'Content-Type': 'application/json' })
  const response = await fetch(`${API_BASE}/billing/admin-activate/`, {
    method: 'POST',
    credentials: 'include',
    headers,
    body: JSON.stringify({
      email,
      user_id: userId,
      until,
    }),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(data.detail || 'Could not activate subscriber.')
  }
  return data
}

export async function changeAdminPassword({
  currentPassword,
  newPassword,
  confirmPassword,
}) {
  const headers = await csrfHeaders({ 'Content-Type': 'application/json' })
  const response = await fetch(`${API_BASE}/auth/change-password/`, {
    method: 'POST',
    credentials: 'include',
    headers,
    body: JSON.stringify({
      current_password: currentPassword,
      new_password: newPassword,
      confirm_password: confirmPassword,
    }),
  })
  if (!response.ok) {
    throw new Error(await parseError(response, 'Could not change password.'))
  }
  return response.json()
}

export async function searchSongs(
  query,
  { signal, letter = 'ALL', category = 'ALL', page = 1, pageSize = 10 } = {},
) {
  const params = new URLSearchParams()
  if (query.trim()) {
    params.set('search', query.trim())
  }
  if (letter && letter !== 'ALL') {
    params.set('letter', letter)
  }
  if (category === 'OPM' || category === 'ENGLISH') {
    params.set('category', category.toLowerCase())
  }
  params.set('page', String(page))
  params.set('page_size', String(pageSize))

  const response = await fetch(`${API_BASE}/songs/?${params.toString()}`, {
    signal,
    credentials: 'include',
  })

  if (!response.ok) {
    throw new Error('Could not load the Official Platinum songbook.')
  }

  return response.json()
}

export async function createSong(payload) {
  const headers = await csrfHeaders({ 'Content-Type': 'application/json' })
  const response = await fetch(`${API_BASE}/songs/`, {
    method: 'POST',
    credentials: 'include',
    headers,
    body: JSON.stringify(payload),
  })
  if (!response.ok) {
    throw new Error(await parseError(response, 'Could not create song.'))
  }
  return response.json()
}

export async function updateSong(id, payload) {
  const headers = await csrfHeaders({ 'Content-Type': 'application/json' })
  const response = await fetch(`${API_BASE}/songs/${id}/`, {
    method: 'PATCH',
    credentials: 'include',
    headers,
    body: JSON.stringify(payload),
  })
  if (!response.ok) {
    throw new Error(await parseError(response, 'Could not update song.'))
  }
  return response.json()
}

export async function deleteSong(id) {
  const headers = await csrfHeaders()
  const response = await fetch(`${API_BASE}/songs/${id}/`, {
    method: 'DELETE',
    credentials: 'include',
    headers,
  })
  if (!response.ok) {
    throw new Error(await parseError(response, 'Could not delete song.'))
  }
  return true
}

export async function uploadSongsCsv(file) {
  const headers = await csrfHeaders()
  const body = new FormData()
  body.append('csv_file', file)
  const response = await fetch(`${API_BASE}/songs/upload-csv/`, {
    method: 'POST',
    credentials: 'include',
    headers,
    body,
  })
  if (!response.ok) {
    throw new Error(await parseError(response, 'CSV upload failed.'))
  }
  return response.json()
}

export async function listReports({
  signal,
  status = 'all',
  search = '',
  page = 1,
  pageSize = 30,
} = {}) {
  const params = new URLSearchParams()
  if (status && status !== 'all') params.set('status', status)
  if (search.trim()) params.set('search', search.trim())
  params.set('page', String(page))
  params.set('page_size', String(pageSize))

  const response = await fetch(`${API_BASE}/reports/?${params.toString()}`, {
    signal,
    credentials: 'include',
  })
  if (!response.ok) {
    throw new Error(await parseError(response, 'Could not load reports.'))
  }
  return response.json()
}

export async function resolveReport(reportId, payload) {
  const headers = await csrfHeaders({ 'Content-Type': 'application/json' })
  const response = await fetch(`${API_BASE}/reports/${reportId}/resolve/`, {
    method: 'POST',
    credentials: 'include',
    headers,
    body: JSON.stringify(payload),
  })
  if (!response.ok) {
    throw new Error(await parseError(response, 'Could not resolve report.'))
  }
  return response.json()
}

export async function fetchOfflinePack({ signal } = {}) {
  const response = await fetch(`${API_BASE}/songs/offline-pack/`, {
    signal,
    credentials: 'include',
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const err = new Error(
      data.detail || 'Could not download the offline catalog.',
    )
    err.code = data.code
    err.status = response.status
    throw err
  }
  return data
}

export async function reportWrongNumber(payload) {
  const response = await fetch(`${API_BASE}/reports/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const noteError = data?.note?.[0]
    throw new Error(noteError || data?.detail || 'Could not submit the report.')
  }
  return data
}

export async function pingPresence({ visitorKey, path = 'songbook' } = {}) {
  // No CSRF round-trip: presence ping uses authentication_classes=[] on the server.
  const response = await fetch(`${API_BASE}/presence/ping/`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      visitor_key: visitorKey,
      path,
    }),
  })
  if (!response.ok) {
    throw new Error(await parseError(response, 'Presence ping failed.'))
  }
  return response.json()
}

export async function listOnlinePresence({ signal } = {}) {
  const response = await fetch(`${API_BASE}/presence/online/`, {
    credentials: 'include',
    signal,
  })
  if (!response.ok) {
    throw new Error(await parseError(response, 'Could not load online users.'))
  }
  return response.json()
}

export async function fetchAnalyticsSummary({ signal } = {}) {
  const response = await fetch(`${API_BASE}/analytics/summary/`, {
    credentials: 'include',
    signal,
  })
  if (!response.ok) {
    throw new Error(await parseError(response, 'Could not load analytics.'))
  }
  return response.json()
}
