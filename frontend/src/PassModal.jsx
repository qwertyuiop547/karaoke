import { PASS_BENEFITS, PASS_PERIOD, PASS_PRICE, TRIAL_DAYS } from './passBenefits'

/**
 * Dedicated Offline Pass offer — benefits first, then Get Pass → sign up / login / trial.
 */
export default function PassModal({
  onClose,
  reason = '',
  loggedIn = false,
  hasAccess = false,
  trialAvailable = false,
  onGetPass,
  onLogin,
  onManage,
  onStartTrial,
}) {
  const primaryLabel = hasAccess
    ? 'Open account'
    : loggedIn && trialAvailable
      ? `Start ${TRIAL_DAYS}-day free trial`
      : loggedIn
        ? 'Get Pass'
        : `Start ${TRIAL_DAYS}-day free trial`

  const onPrimary = () => {
    if (hasAccess) {
      onManage?.()
      return
    }
    if (loggedIn && trialAvailable) {
      onStartTrial?.()
      return
    }
    onGetPass?.()
  }

  return (
    <div className="drawer-overlay install-app-overlay" onClick={onClose}>
      <div
        className="modal-card account-modal pass-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pass-modal-title"
      >
        <button
          type="button"
          className="account-modal-close"
          onClick={onClose}
          aria-label="Close"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path
              d="M6 6l12 12M18 6L6 18"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </button>

        <div className="account-pass-banner" aria-hidden="true">
          <div className="account-pass-ticket">
            <div className="account-pass-ticket-main">
              <span className="account-pass-brand">Platino</span>
              <strong>Offline Pass</strong>
              <span className="account-pass-price">
                {PASS_PRICE}
                <em>{PASS_PERIOD}</em>
              </span>
            </div>
            <div className="account-pass-stub">
              <svg className="account-pass-mic" viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="9" r="4" fill="none" stroke="currentColor" strokeWidth="1.8" />
                <path
                  d="M12 13v5M8 21h8"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              </svg>
            </div>
          </div>
        </div>

        <header className="account-modal-header">
          <p className="account-modal-kicker">
            {hasAccess ? 'Active' : `${TRIAL_DAYS}-day trial`}
          </p>
          <h2 id="pass-modal-title">
            {hasAccess ? 'Your Offline Pass' : 'Offline Pass'}
          </h2>
          <p className="account-modal-lead">
            {hasAccess
              ? 'Pass is active on this account — manage billing or save the catalog.'
              : `Subukan muna nang libre for ${TRIAL_DAYS} days. Pagkatapos, ${PASS_PRICE}${PASS_PERIOD} para magpatuloy.`}
          </p>
          {reason && !hasAccess ? <p className="account-modal-reason">{reason}</p> : null}
        </header>

        {!hasAccess ? (
          <ul className="account-benefits" aria-label="What you get with Offline Pass">
            {PASS_BENEFITS.map((item) => (
              <li key={item.title}>
                <span className="account-benefit-check" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="14" height="14">
                    <path
                      d="M5 12.5l4.2 4.2L19 7"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
                <div>
                  <strong>{item.title}</strong>
                  <p>{item.detail}</p>
                </div>
              </li>
            ))}
          </ul>
        ) : null}

        <div className="pass-modal-actions">
          <button type="button" className="account-primary-btn" onClick={onPrimary}>
            {primaryLabel}
          </button>
          {!hasAccess && !loggedIn ? (
            <button type="button" className="account-text-btn" onClick={onLogin}>
              May account ka na? Log in
            </button>
          ) : null}
          {!hasAccess && loggedIn && !trialAvailable ? (
            <p className="account-modal-footnote">
              Trial used — continue with {PASS_PRICE}
              {PASS_PERIOD} checkout.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  )
}
