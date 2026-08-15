import React from 'react'
import ReactDOM from 'react-dom/client'
import AdminApp from './AdminApp'
import '../index.css'

const rootElement = document.getElementById('admin-root')
if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <AdminApp />
    </React.StrictMode>
  )
}
