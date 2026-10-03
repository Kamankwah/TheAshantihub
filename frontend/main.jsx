import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import './index.css'
import { ensureStaffHead, isStaffPathname, startStaffPwa } from './lib/staffPwa.js'

// Staff app: link the /staff-scoped manifest and start listening for the
// install prompt as early as possible on a staff URL (beforeinstallprompt can
// fire before React has mounted). App.jsx keeps both in sync on in-app
// navigation afterwards.
if (isStaffPathname(window.location.pathname)) {
  ensureStaffHead(true)
  startStaffPwa()
}

const queryClient = new QueryClient()

// BrowserRouter wraps App so AshantiHub (App.jsx's default export) can read
// the current URL via useLocation()/useNavigate() — see
// docs/UI_MODERNIZATION_ROADMAP.md Phase D. AshantiHub reads the router
// directly (no <Routes>/<Route> matching needed for a single always-mounted
// component); BrowserRouter just needs to be an ancestor.
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </BrowserRouter>
  </React.StrictMode>,
)
