import React from 'react'
import ReactDOM from 'react-dom/client'
import { toast } from '@/stores/ui-store'
import App from './App'
import './assets/index.css'

window.addEventListener('unhandledrejection', (event) => {
  const reason: unknown = event.reason
  const message =
    reason instanceof Error ? reason.message : typeof reason === 'string' ? reason : ''
  if (!message) return
  toast({ tone: 'error', title: 'Có lỗi chưa được xử lý', description: message })
})

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
