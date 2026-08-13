import { PASS_PERIOD, PASS_PRICE } from './passBenefits'

export const GCASH_PAYMENT_NOTE = 'Karaoke Pass'
export const GCASH_QR_SRC = '/gcash-qr.png'

/**
 * Manual GCash / InstaPay QR paywall instructions.
 */
export default function GCashPayPanel({ compact = false }) {
  const copyNote = async () => {
    try {
      await navigator.clipboard.writeText(GCASH_PAYMENT_NOTE)
    } catch {
      window.prompt('Copy this payment note:', GCASH_PAYMENT_NOTE)
    }
  }

  return (
    <div className={`gcash-pay ${compact ? 'is-compact' : ''}`}>
      <div className="gcash-pay-head">
        <p className="gcash-pay-kicker">Pay via GCash / InstaPay</p>
        <strong>
          {PASS_PRICE}
          <em>{PASS_PERIOD}</em>
        </strong>
      </div>

      <div className="gcash-pay-qr-wrap">
        <img
          className="gcash-pay-qr"
          src={GCASH_QR_SRC}
          alt="GCash InstaPay QR code for Offline Pass"
          width={220}
          height={220}
        />
      </div>

      <ol className="gcash-pay-steps">
        <li>Scan this QR with GCash / any InstaPay bank app.</li>
        <li>
          Amount: <strong>{PASS_PRICE}</strong>
        </li>
        <li>
          Message / Note:{' '}
          <strong className="gcash-pay-note">{GCASH_PAYMENT_NOTE}</strong>
          <button type="button" className="gcash-pay-copy" onClick={copyNote}>
            Copy note
          </button>
        </li>
        <li>
          After paying, message admin with your <strong>email</strong> + screenshot so they
          can Activate your Offline Pass.
        </li>
      </ol>
    </div>
  )
}
