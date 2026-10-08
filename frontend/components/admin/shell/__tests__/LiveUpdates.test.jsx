import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SESSION_ENDED_EVENT, setStoredAuth } from '../../../../apiClient.js'
import { server } from '../../../../mocks/server.js'
import AdminCommandCenter from '../../AdminCommandCenter.jsx'
import LiveUpdatesIndicator from '../LiveUpdatesIndicator.jsx'

const auth = {
  user: { token: 't', account_type: 'staff', id: 1, full_name: 'Esi Nyarko', role: 'support', permissions: [] },
  hasPermission: () => false,
}

// Signed in, as the app is: the shell signs out on mount without a session.
beforeEach(() => setStoredAuth({ token: 't', account_type: 'staff', id: 1, full_name: 'Esi Nyarko' }))
afterEach(() => { setStoredAuth(null); vi.unstubAllGlobals() })

class FakeSocket {
  constructor(url) { this.url = url; FakeSocket.all.push(this) }
  close() {}
}

describe('live updates in the staff shell', () => {
  it('refetches the signed-in staffer when the server forces a reconnect, so menus follow new permissions', async () => {
    FakeSocket.all = []
    vi.stubGlobal('WebSocket', FakeSocket)
    server.use(http.post('http://localhost:8000/api/realtime/ticket/', () => HttpResponse.json({ ticket: 'tkt', expires_in: 30 })))
    const refreshUser = vi.fn(async () => ({}))
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { unmount } = render(
      <QueryClientProvider client={queryClient}><AdminCommandCenter auth={{ ...auth, refreshUser }} onExit={vi.fn()} /></QueryClientProvider>,
    )
    await waitFor(() => expect(FakeSocket.all).toHaveLength(1))
    const socket = FakeSocket.all[0]
    act(() => { socket.onopen?.() })
    expect(refreshUser).not.toHaveBeenCalled()
    act(() => { socket.onmessage?.({ data: JSON.stringify({ type: 'force_disconnect' }) }) })
    expect(refreshUser).toHaveBeenCalledTimes(1)
    unmount()
  })


  it('shows "Live updates paused" only when paused', () => {
    const { rerender } = render(<LiveUpdatesIndicator paused={false} />)
    expect(screen.queryByText('Live updates paused')).not.toBeInTheDocument()
    rerender(<LiveUpdatesIndicator paused />)
    expect(screen.getByRole('status')).toHaveTextContent('Live updates paused')
  })

  it('signs out when the server says the session has ended', () => {
    const onExit = vi.fn()
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={queryClient}><AdminCommandCenter auth={auth} onExit={onExit} /></QueryClientProvider>)
    act(() => { window.dispatchEvent(new Event(SESSION_ENDED_EVENT)) })
    expect(onExit).toHaveBeenCalledTimes(1)
    expect(sessionStorage.getItem('ashantihub.signedOutReason')).toBe('ended')
  })
})

describe('sign-out from another tab', () => {
  it('signs this tab out when another tab clears the stored session', () => {
    const onExit = vi.fn()
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    sessionStorage.removeItem('ashantihub.signedOutReason')
    const { unmount } = render(<QueryClientProvider client={queryClient}><AdminCommandCenter auth={auth} onExit={onExit} /></QueryClientProvider>)
    act(() => { window.dispatchEvent(new StorageEvent('storage', { key: 'ashantihub.auth', newValue: null })) })
    expect(onExit).toHaveBeenCalledTimes(1)
    expect(sessionStorage.getItem('ashantihub.signedOutReason')).toBe('ended')
    unmount()
    act(() => { window.dispatchEvent(new StorageEvent('storage', { key: 'ashantihub.auth', newValue: null })) })
    expect(onExit).toHaveBeenCalledTimes(1)
  })

  it('keeps the indicator region mounted and only toggles its text', () => {
    const { rerender } = render(<LiveUpdatesIndicator paused={false} />)
    const region = screen.getByRole('status')
    expect(region).toHaveAttribute('aria-live', 'polite')
    expect(region).toBeEmptyDOMElement()
    rerender(<LiveUpdatesIndicator paused />)
    expect(screen.getByRole('status')).toBe(region)
    expect(region).toHaveTextContent('Live updates paused')
  })
})
