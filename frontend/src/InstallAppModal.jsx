/**
 * Dedicated Install App flow so offline mode works reliably:
 * 1) Install as PWA (home screen / desktop app)
 * 2) Subscribe (Offline Pass) + download the song catalog
 */
export default function InstallAppModal({
  onClose,
  offlineMeta,
  syncingOffline,
  onSaveOffline,
  installed,
  ios,
  canPromptInstall,
  promptInstall,
  hasOfflineAccess = false,
  onOpenAccount,
}) {
  const catalogReady = Boolean(hasOfflineAccess && offlineMeta?.count)

  const handleInstall = async () => {
    if (installed) return
    if (canPromptInstall) {
      const result = await promptInstall?.()
      if (result?.ok && !catalogReady && !syncingOffline && hasOfflineAccess) {
        onSaveOffline?.()
      } else if (result?.ok && !hasOfflineAccess) {
        onOpenAccount?.()
      } else if (result?.reason === 'dismissed') {
        /* user closed native prompt — keep modal open */
      }
      return
    }
    // No native prompt (common on iOS / already-dismissed Chrome) — scroll hints into view.
    document.getElementById('install-manual-hint')?.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
    })
  }

  const handleCatalog = () => {
    if (!hasOfflineAccess) {
      onOpenAccount?.()
      return
    }
    onSaveOffline?.()
  }

  return (
    <div className="drawer-overlay install-app-overlay" onClick={onClose}>
      <div
        className="modal-card install-app-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="install-app-title"
      >
        <button
          type="button"
          className="close-drawer-btn install-app-close"
          onClick={onClose}
          aria-label="Close"
        >
          ✕
        </button>

        <div className="install-app-hero">
          <img
            className="install-app-icon"
            src="/pwa-192.png"
            width={72}
            height={72}
            alt=""
          />
          <p className="install-app-kicker">Offline mode</p>
          <h2 id="install-app-title">Install Songbook</h2>
          <p className="install-app-lead">
            I-install ang app, then unlock Offline Pass para i-download ang song
            catalog.
          </p>
        </div>

        <ol className="install-app-steps">
          <li className={installed ? 'is-done' : ''}>
            <span className="install-step-num" aria-hidden="true">
              {installed ? '✓' : '1'}
            </span>
            <div>
              <strong>Install the app</strong>
              <p>
                {installed
                  ? 'Installed — open from your home screen or app list.'
                  : ios
                    ? 'Sa Safari: Share → Add to Home Screen.'
                    : canPromptInstall
                      ? 'Tap Install App below — adds Platino to your device.'
                      : 'Tap Install App below for steps (Chrome/Edge menu → Install app).'}
              </p>
            </div>
          </li>
          <li className={hasOfflineAccess ? 'is-done' : ''}>
            <span className="install-step-num" aria-hidden="true">
              {hasOfflineAccess ? '✓' : '2'}
            </span>
            <div>
              <strong>Offline Pass</strong>
              <p>
                {hasOfflineAccess
                  ? 'Subscription active — unlimited favorites + offline catalog.'
                  : 'Unlocks unlimited favorites + full offline song catalog.'}
              </p>
            </div>
          </li>
          <li className={catalogReady ? 'is-done' : ''}>
            <span className="install-step-num" aria-hidden="true">
              {catalogReady ? '✓' : '3'}
            </span>
            <div>
              <strong>Save song catalog</strong>
              <p>
                {catalogReady
                  ? `${offlineMeta.count.toLocaleString()} songs ready offline · auto-updates when online.`
                  : 'One-time download (~10k songs) para gumana ang smart search offline.'}
              </p>
            </div>
          </li>
        </ol>

        <div className="install-app-actions">
          {!installed ? (
            <button
              type="button"
              className="admin-action-btn install-primary-btn"
              onClick={handleInstall}
            >
              {canPromptInstall ? 'Install App' : ios ? 'How to install (iOS)' : 'Install App'}
            </button>
          ) : null}

          {!installed ? (
            <p id="install-manual-hint" className="install-ios-hint">
              {ios ? (
                <>
                  Tap <strong>Share</strong> (□↑) sa Safari, then{' '}
                  <strong>Add to Home Screen</strong>.
                </>
              ) : canPromptInstall ? (
                <>Chrome/Edge will show a system install dialog.</>
              ) : (
                <>
                  Open browser menu (⋮) → <strong>Install app</strong> /{' '}
                  <strong>Add to Home screen</strong>. Kung wala, use Chrome/Edge
                  over HTTPS and refresh once.
                </>
              )}
            </p>
          ) : null}

          {!hasOfflineAccess ? (
            <button
              type="button"
              className="admin-action-btn install-primary-btn"
              onClick={() => onOpenAccount?.()}
            >
              Unlock Offline Pass
            </button>
          ) : null}

          {!catalogReady ? (
            <button
              type="button"
              className="admin-action-btn install-secondary-btn"
              onClick={handleCatalog}
              disabled={syncingOffline}
            >
              {syncingOffline
                ? 'Downloading…'
                : hasOfflineAccess
                  ? 'Save Offline Catalog'
                  : 'Sign in / Subscribe'}
            </button>
          ) : (
            <p className="install-ready-note">
              Offline ready · {offlineMeta.count.toLocaleString()} songs
            </p>
          )}

          {installed && catalogReady && hasOfflineAccess ? (
            <button type="button" className="admin-action-btn" onClick={onClose}>
              Done
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
