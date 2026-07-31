import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { loadJoinUrl } from './joinUrl'

export default function JoinQrModal({ onClose }) {
  const [dataUrl, setDataUrl] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    async function render() {
      try {
        const next = await QRCode.toDataURL(loadJoinUrl(), {
          width: 512,
          margin: 2,
          color: { dark: '#120e0a', light: '#fff8e8' },
          errorCorrectionLevel: 'M',
        })
        if (!cancelled) {
          setDataUrl(next)
          setError('')
        }
      } catch (err) {
        if (!cancelled) {
          setDataUrl('')
          setError(err.message || 'Could not build QR code.')
        }
      }
    }
    render()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="drawer-overlay join-qr-overlay" onClick={onClose}>
      <div
        className="modal-card join-qr-modal join-qr-modal-simple"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="join-qr-title"
      >
        <button
          type="button"
          className="close-drawer-btn join-qr-close"
          onClick={onClose}
          aria-label="Close"
        >
          ✕
        </button>

        <div className="join-qr-body join-qr-body-simple">
          <div className="join-qr-preview" id="join-poster-print">
            <p className="join-poster-kicker" id="join-qr-title">
              Scan to open
            </p>
            <h3 className="join-poster-title">Songbook</h3>
            <div className="join-qr-frame">
              {dataUrl ? (
                <img src={dataUrl} alt="QR code to open the songbook" />
              ) : (
                <div className="join-qr-placeholder">{error || 'Building QR…'}</div>
              )}
            </div>
            <p className="join-poster-foot">Point your camera here · no app install</p>
          </div>
        </div>
      </div>
    </div>
  )
}
