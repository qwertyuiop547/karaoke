/** Shared Offline Pass marketing copy (Account modal + paywall). */

export const PASS_PRICE = import.meta.env.VITE_OFFLINE_PASS_PRICE || '₱149'
export const PASS_PERIOD = import.meta.env.VITE_OFFLINE_PASS_PERIOD || '/mo'
export const PASS_LABEL =
  import.meta.env.VITE_OFFLINE_PASS_LABEL || `Offline Pass · ${PASS_PRICE}${PASS_PERIOD}`

export const PASS_BENEFITS = [
  {
    title: 'Unlimited favorites',
    detail: 'Free plan stops at 10 saves — Pass unlocks unlimited ☆ Save.',
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
