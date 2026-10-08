import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SESSION_ENDED_EVENT } from '../../../../apiClient.js'
import AdminCommandCenter from '../../AdminCommandCenter.jsx'
import LiveUpdatesIndicator from '../LiveUpdatesIndicator.jsx'

const auth = {
  user: { token: 't', account_type: 'staff', id: 1, full_name: 'Esi Nyarko', role: 'support', permissions: [] },
  hasPermission: () => false,
}

describe('live updates in the staff shell', () => {
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
