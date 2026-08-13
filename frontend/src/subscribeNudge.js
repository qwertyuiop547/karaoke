import { PASS_PRICE, PASS_PERIOD, getPassStatusInfo } from './passBenefits'

/** How often to re-prompt Subscribe now after trial ends or near expiration. */
export const SUBSCRIBE_NUDGE_INTERVAL_MS = 5 * 60 * 60 * 1000

/** Delay before first nudge on a session when already overdue (don’t block first paint). */
export const SUBSCRIBE_NUDGE_SESSION_DELAY_MS = 9000

const STORAGE_PREFIX = 'platino_subscribe_nudge_at:'

export function subscribeNudgeStorageKey(email = '') {
  const id = String(email || 'anon').trim().toLowerCase() || 'anon'
  return `${STORAGE_PREFIX}${id}`
}

/** Eligible for Subscribe now reminders (post-trial free plan OR trial with <= 1 day left). */
export function shouldNudgeSubscribe(account) {
  if (!account?.authenticated) return false
  const sub = account.subscription || {}
  if (sub.is_banned) return false

  const statusInfo = getPassStatusInfo(account)
  // Nudge post-trial users whose trial ended
  if (statusInfo.statusType === 'expired') return true
  // Also nudge trialing users when 1 day or less remains on their trial to avoid churn
  if (statusInfo.statusType === 'trial' && typeof statusInfo.daysLeft === 'number' && statusInfo.daysLeft <= 1) {
    return true
  }

  return false
}

export function getLastSubscribeNudgeAt(email) {
  try {
    const raw = localStorage.getItem(subscribeNudgeStorageKey(email))
    const n = raw ? Number(raw) : 0
    return Number.isFinite(n) && n > 0 ? n : 0
  } catch {
    return 0
  }
}

export function markSubscribeNudgeShown(email, at = Date.now()) {
  try {
    localStorage.setItem(subscribeNudgeStorageKey(email), String(at))
  } catch {
    /* ignore quota / private mode */
  }
  return at
}

export function msUntilNextSubscribeNudge(email, now = Date.now()) {
  const last = getLastSubscribeNudgeAt(email)
  if (!last) return 0
  return Math.max(0, last + SUBSCRIBE_NUDGE_INTERVAL_MS - now)
}

export function subscribeNudgeCopy(account) {
  const statusInfo = getPassStatusInfo(account)

  if (statusInfo.statusType === 'trial') {
    return {
      reason: `${statusInfo.statusText}. Subscribe now (${PASS_PRICE}${PASS_PERIOD} via GCash) para magtuloy-tuloy ang offline access + unlimited favorites.`,
      kicker: statusInfo.kickerText,
      title: statusInfo.statusText,
      lead: `Huwag palampasin — i-activate ang Offline Pass for ${PASS_PRICE}${PASS_PERIOD}. Offline search, unlimited favorites, at venue-ready songbook.`,
    }
  }

  const endFormatted = statusInfo.formattedEnd ? ` on ${statusInfo.formattedEnd}` : ''
  return {
    reason: `Your free trial ended${endFormatted}. Subscribe now (${PASS_PRICE}${PASS_PERIOD} via GCash) para maibalik ang offline catalog + unlimited favorites.`,
    kicker: 'Trial ended',
    title: 'Miss your Offline Pass?',
    lead: `Huwag palampasin — i-activate ang Offline Pass for ${PASS_PRICE}${PASS_PERIOD}. Offline search, unlimited favorites, at venue-ready songbook.`,
  }
}

