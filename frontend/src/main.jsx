import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import './index.css'

// Capture install prompt ASAP — the event fires once and is easy to miss.
if (typeof window !== 'undefined') {
  window.__PLATINO_DEFERRED_INSTALL__ = window.__PLATINO_DEFERRED_INSTALL__ || null
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
    window.__PLATINO_DEFERRED_INSTALL__ = event
    window.dispatchEvent(new CustomEvent('platino-beforeinstallprompt'))
  })
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        // Force check for updated SW so installability / shell stay current.
        reg.update?.().catch(() => {})
      })
      .catch(() => {
        // Ignore SW registration failures in local/dev edge cases
      })
  })
}
