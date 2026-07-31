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
  const catalogReady = Boolean(offlineMeta?.count)

  const handleInstall = async () => {
    const result = await promptInstall?.()
    if (result?.ok && !catalogReady && !syncingOffline && hasOfflineAccess) {
      onSaveOffline?.()
    } else if (result?.ok && !hasOfflineAccess) {
      onOpenAccount?.()
    }
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
                      ? 'Tap Install below — adds Platino to your device.'
                      : 'Use Chrome/Edge menu → Install app / Add to Home screen.'}
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
          {!installed && canPromptInstall ? (
            <button
              type="button"
              className="admin-action-btn install-primary-btn"
              onClick={handleInstall}
            >
              Install App
            </button>
          ) : null}

          {!installed && ios ? (
            <p className="install-ios-hint">
              Tap <strong>Share</strong> (□↑) sa Safari, then{' '}
              <strong>Add to Home Screen</strong>.
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
