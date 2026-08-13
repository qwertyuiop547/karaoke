import { getDeviceId } from './deviceId'

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

function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

/**
 * Retry slow first requests (cold start / brief network blips).
 */
export async function fetchWithWake(url, options = {}, { retries = 5, onRetry } = {}) {
  let lastError
  for (let attempt = 0; attempt < retries; attempt += 1) {
    if (options.signal?.aborted) {
      const err = new Error('Aborted')
      err.name = 'AbortError'
      throw err
    }
    const timeoutMs = attempt === 0 ? 15000 : 30000
    const controller = new AbortController()
    const onAbort = () => controller.abort()
    options.signal?.addEventListener('abort', onAbort, { once: true })
    const timer = window.setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      })
      if (response.ok || (response.status >= 400 && response.status < 500)) {
        return response
      }
      lastError = new Error(`Server returned ${response.status}`)
    } catch (err) {
      if (err?.name === 'AbortError' && options.signal?.aborted) throw err
      lastError = err
    } finally {
      window.clearTimeout(timer)
      options.signal?.removeEventListener('abort', onAbort)
    }

    if (attempt < retries - 1) {
      onRetry?.(attempt + 1, retries)
      await sleep(800 + attempt * 1200)
    }
  }
  throw lastError || new Error('Server is waking up. Please try again.')
}

export async function fetchCsrf() {
  if (!csrfPromise) {
    csrfPromise = fetchWithWake(
      `${API_BASE}/auth/csrf/`,
      { credentials: 'include' },
      { retries: 3 },
    )
      .then(async (response) => {
        if (!response.ok) {
          throw new Error('Could not initialize login security token.')
        }
        return response.json()
      })
      .catch((err) => {
        csrfPromise = null
        throw err
      })
      .finally(() => {
        window.setTimeout(() => {
          csrfPromise = null
        }, 5 * 60 * 1000)
      })
  }
  return csrfPromise
}

export async function adminLogin(username, password) {
  const headers = await csrfHeaders({ 'Content-Type': 'application/json' })
  const response = await fetchWithWake(
    `${API_BASE}/auth/login/`,
    {
      method: 'POST',
      credentials: 'include',
      headers,
      body: JSON.stringify({ username, password }),
    },
    { retries: 3 },
  )
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

export async function subscriberRegister({ email, password, confirmPassword, referralCode }) {
  const headers = await csrfHeaders({
    'Content-Type': 'application/json',
    'X-Device-Id': getDeviceId(),
  })
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), 20000)
  try {
    const response = await fetch(`${API_BASE}/auth/register/`, {
      method: 'POST',
      credentials: 'include',
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        email,
        password,
        confirm_password: confirmPassword,
        device_id: getDeviceId(),
        referral_code: referralCode,
      }),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      throw new Error(data.detail || 'Could not create account.')
    }
    return data
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw new Error('Sign up timed out. Please try again.')
    }
    throw err
  } finally {
    window.clearTimeout(timer)
  }
}

export async function applyReferralCode(referralCode) {
  const headers = await csrfHeaders({ 'Content-Type': 'application/json' })
  const response = await fetch(`${API_BASE}/subscribers/apply-referral/`, {
    method: 'POST',
    credentials: 'include',
    headers,
    body: JSON.stringify({ referral_code: referralCode }),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(data.detail || 'Could not apply referral code.')
  }
  return data
}

export async function subscriberLogin(email, password) {
  const headers = await csrfHeaders({ 'Content-Type': 'application/json' })
  const response = await fetchWithWake(
    `${API_BASE}/auth/subscriber-login/`,
    {
      method: 'POST',
      credentials: 'include',
      headers,
      body: JSON.stringify({ email, password }),
    },
    { retries: 3 },
  )
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
  const headers = await csrfHeaders({
    'Content-Type': 'application/json',
    'X-Device-Id': getDeviceId(),
  })
  const response = await fetch(`${API_BASE}/billing/checkout/`, {
    method: 'POST',
    credentials: 'include',
    headers,
    body: JSON.stringify({ device_id: getDeviceId() }),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const err = new Error(data.detail || 'Could not start checkout.')
    err.code = data.code
    throw err
  }
  return data
}

export async function startOfflineTrial() {
  const headers = await csrfHeaders({
    'Content-Type': 'application/json',
    'X-Device-Id': getDeviceId(),
  })
  const response = await fetch(`${API_BASE}/billing/start-trial/`, {
    method: 'POST',
    credentials: 'include',
    headers,
    body: JSON.stringify({ device_id: getDeviceId() }),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const err = new Error(data.detail || 'Could not start free trial.')
    err.code = data.code
    throw err
  }
  return data
}

export async function verifyEmailToken(token) {
  const headers = await csrfHeaders({ 'Content-Type': 'application/json' })
  const response = await fetch(`${API_BASE}/auth/verify-email/`, {
    method: 'POST',
    credentials: 'include',
    headers,
    body: JSON.stringify({ token }),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(data.detail || 'Could not verify email.')
  }
  return data
}

export async function resendVerificationEmail() {
  const headers = await csrfHeaders({ 'Content-Type': 'application/json' })
  const response = await fetch(`${API_BASE}/auth/resend-verification/`, {
    method: 'POST',
    credentials: 'include',
    headers,
    body: '{}',
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(data.detail || 'Could not resend verification email.')
  }
  return data
}

export async function adminModerateSubscriber({ email, userId, action }) {
  const headers = await csrfHeaders({ 'Content-Type': 'application/json' })
  const response = await fetch(`${API_BASE}/billing/admin-moderate/`, {
    method: 'POST',
    credentials: 'include',
    headers,
    body: JSON.stringify({
      email,
      user_id: userId,
      action,
    }),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(data.detail || 'Moderation failed.')
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
  { signal, letter = 'ALL', category = 'ALL', page = 1, pageSize = 10, onRetry } = {},
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

  const response = await fetchWithWake(
    `${API_BASE}/songs/?${params.toString()}`,
    {
      signal,
      credentials: 'include',
    },
    { onRetry },
  )

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

export async function fetchOfflinePack({ signal, etag } = {}) {
  const headers = {}
  const cleanEtag = etag ? String(etag).trim().replace(/^W\//i, '').replace(/^"|"$/g, '') : ''
  if (cleanEtag) {
    headers['If-None-Match'] = `"${cleanEtag}"`
  }

  const response = await fetch(`${API_BASE}/songs/offline-pack/`, {
    signal,
    credentials: 'include',
    headers,
  })

  if (response.status === 304) {
    return {
      notModified: true,
      etag: cleanEtag || response.headers.get('ETag'),
      count: 0,
      results: [],
    }
  }

  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const err = new Error(
      data.detail || 'Could not download the offline catalog.',
    )
    err.code = data.code
    err.status = response.status
    throw err
  }
  return {
    ...data,
    notModified: false,
    etag: response.headers.get('ETag') || cleanEtag || null,
  }
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

export async function fetchReferralCampaigns({ signal } = {}) {
  const response = await fetch(`${API_BASE}/billing/admin-referral-campaigns/`, {
    credentials: 'include',
    signal,
  })
  if (!response.ok) {
    throw new Error(await parseError(response, 'Could not load referral campaigns.'))
  }
  return response.json()
}

export async function saveReferralCampaign(payload) {
  const headers = await csrfHeaders({ 'Content-Type': 'application/json' })
  const response = await fetch(`${API_BASE}/billing/admin-referral-campaigns/`, {
    method: 'POST',
    credentials: 'include',
    headers,
    body: JSON.stringify(payload),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(data.detail || 'Could not save referral campaign.')
  }
  return data
}

export async function deleteReferralCampaign(id) {
  const headers = await csrfHeaders({ 'Content-Type': 'application/json' })
  const response = await fetch(`${API_BASE}/billing/admin-referral-campaigns/`, {
    method: 'DELETE',
    credentials: 'include',
    headers,
    body: JSON.stringify({ id }),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(data.detail || 'Could not delete referral campaign.')
  }
  return data
}
