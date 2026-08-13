import { FREE_FAVORITE_LIMIT } from './favorites'

/** Shared Offline Pass marketing copy (Account modal + paywall). */

export const PASS_PRICE = import.meta.env.VITE_OFFLINE_PASS_PRICE || '₱149'
export const PASS_PERIOD = import.meta.env.VITE_OFFLINE_PASS_PERIOD || '/mo'
export const PASS_LABEL =
  import.meta.env.VITE_OFFLINE_PASS_LABEL || `Offline Pass · ${PASS_PRICE}${PASS_PERIOD}`
export const TRIAL_DAYS = Number(import.meta.env.VITE_OFFLINE_TRIAL_DAYS || 3) || 3

export const PASS_BENEFITS = [
  {
    title: `${TRIAL_DAYS}-day free trial`,
    detail: `Sign up and try Offline Pass free for ${TRIAL_DAYS} days. After that, pay via GCash QR (note: Karaoke Pass) — admin activates your account.`,
  },
  {
    title: 'Unlimited favorites',
    detail: `Free plan stops at ${FREE_FAVORITE_LIMIT} saves — Pass unlocks unlimited ☆ Save.`,
  },
  {
    title: 'Full offline catalog',
    detail: 'Download ~10,000 Platinum songs and search without Wi‑Fi.',
  },
  {
    title: 'Auto catalog updates',
    detail: 'When you’re back online, new Platinum numbers sync quietly in the background.',
  },
  {
    title: 'Smart offline search',
    detail: 'Finds songs despite typos, nicknames, and partial song numbers.',
  },
  {
    title: 'Installable app',
    detail: 'Add to Home Screen for one-tap songbook access.',
  },
  {
    title: 'Works at the venue',
    detail: 'Keep finding song numbers even when signal is weak.',
  },
]

/** Format ISO date string into readable short format, e.g. "Aug 15" */
export function formatPassEndDate(isoDate) {
  if (!isoDate) return ''
  try {
    const d = new Date(isoDate)
    if (Number.isNaN(d.getTime())) return ''
    return d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    })
  } catch {
    return ''
  }
}

/**
 * Returns formatted status info for clear activation & trial countdown display:
 * - "Activated until Aug 15" when active subscription / override has end date
 * - "3 days left on your trial" / "1 day left on your trial" / "Trial ends today" when trialing
 */
export function getPassStatusInfo(account) {
  if (!account || !account.authenticated) {
    return {
      statusType: 'none',
      statusText: 'No active subscription',
      kickerText: `${TRIAL_DAYS}-day trial`,
      badgeText: '',
      daysLeft: null,
      endDate: null,
      formattedEnd: '',
    }
  }

  const sub = account.subscription || {}
  const hasAccess = Boolean(account.offline_access)
  const endIso = sub.manual_override_until || sub.current_period_end
  const endDate = endIso ? new Date(endIso) : null
  const now = new Date()

  // Prefer server-provided status_label / formatted_end if present
  const serverFormattedEnd = sub.formatted_end || formatPassEndDate(endIso)

  const isTrialing =
    Boolean(sub.is_trialing) ||
    (String(sub.status || '').toLowerCase() === 'trialing' &&
      endDate &&
      endDate.getTime() > now.getTime())

  if (hasAccess && isTrialing) {
    let daysLeft = typeof sub.days_left === 'number' ? sub.days_left : null
    if (daysLeft === null && endDate && endDate.getTime() > now.getTime()) {
      const diffMs = endDate.getTime() - now.getTime()
      daysLeft = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)))
    }
    if (daysLeft === null) daysLeft = TRIAL_DAYS

    let statusText = ''
    if (daysLeft > 1) {
      statusText = `${daysLeft} days left on your trial`
    } else if (daysLeft === 1) {
      statusText = '1 day left on your trial'
    } else if (daysLeft === 0) {
      statusText = 'Trial ends today'
    } else {
      statusText = 'Trial ended'
    }

    return {
      statusType: 'trial',
      statusText,
      kickerText: statusText,
      badgeText: statusText,
      daysLeft,
      endDate,
      formattedEnd: serverFormattedEnd,
    }
  }

  if (hasAccess) {
    const statusText = serverFormattedEnd ? `Activated until ${serverFormattedEnd}` : 'Activated'
    return {
      statusType: 'active',
      statusText,
      kickerText: 'Activated',
      badgeText: statusText,
      daysLeft: null,
      endDate,
      formattedEnd: serverFormattedEnd,
    }
  }

  const postTrial = Boolean(sub.trial_used) && !sub.trial_available
  return {
    statusType: postTrial ? 'expired' : 'free',
    statusText: postTrial ? 'Trial ended · Subscribe to unlock' : 'Free plan',
    kickerText: postTrial ? 'Trial ended' : 'Free plan',
    badgeText: postTrial ? 'Trial ended' : 'Free plan',
    daysLeft: 0,
    endDate: null,
    formattedEnd: '',
  }
}

