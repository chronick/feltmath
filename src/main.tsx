import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'
import { installPreloadErrorRecovery } from './preloadRecovery'

installPreloadErrorRecovery()

const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('Root element #root not found')

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// PWA: only register the worker in a real build — in dev it would shadow HMR.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    // Relative path keeps the scope correct on project pages (…/blackjack-trainer/).
    navigator.serviceWorker.register('./sw.js').catch(() => {
      /* offline support is a bonus; never block the app on it */
    })
  })
}
