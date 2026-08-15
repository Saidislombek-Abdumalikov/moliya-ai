import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { FinanceProvider } from './FinanceContext'
import ErrorBoundary from './components/ErrorBoundary'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <FinanceProvider>
        <App />
      </FinanceProvider>
    </ErrorBoundary>
  </React.StrictMode>,
)

// Register Service Worker for offline PWA capabilities
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then(
      (reg) => console.log('[SW] ServiceWorker registered successfully:', reg.scope),
      (err) => console.log('[SW] ServiceWorker registration failed:', err)
    )
  })
}
