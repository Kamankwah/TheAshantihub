import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { server } from '../../../../mocks/server.js'
import StaffManagementPanel from '../StaffManagementPanel.jsx'

afterEach(() => { delete navigator.clipboard })

function renderPanel() {
  server.use(http.get('http://localhost:8000/api/accounts/staff/', () => HttpResponse.json({ count: 0, next: null, previous: null, results: [] })))
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}><StaffManagementPanel /></QueryClientProvider>)
}

describe('StaffManagementPanel staff app link', () => {
  it('shows the /staff/install link for sharing and copies it', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    renderPanel()
    expect(screen.getByText('Staff app link')).toBeInTheDocument()
    expect(screen.getByText('localhost:3000/staff/install')).toBeInTheDocument()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copy link' })) })
    expect(writeText).toHaveBeenCalledWith('http://localhost:3000/staff/install')
  })
})

describe('StaffManagementPanel roster', () => {
  const row = (id, name, extra) => ({ id, full_name: name, email: `${id}@example.com`, role: 'support', status: 'active', permissions: [], role_permissions: [], ...extra })

  it("shows each staffer's last sign-in, and says so honestly when there was none in 90 days", async () => {
    const when = new Date(2025, 9, 5, 9, 40).toISOString()
    server.use(http.get('http://localhost:8000/api/accounts/staff/', () => HttpResponse.json({
      count: 3, next: null, previous: null,
      results: [
        row(1, 'Esi Nyarko', { last_sign_in_at: when }),
        row(2, 'Kojo Mensah', { last_sign_in_at: null }),
        row(3, 'Old Payload'), // no field at all: say nothing rather than guess
      ],
    })))
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={queryClient}><StaffManagementPanel /></QueryClientProvider>)
    expect(await screen.findByText(/^Last sign-in 5 Oct, 09:40/)).toBeInTheDocument()
    expect(screen.getAllByText('No sign-in in the last 90 days')).toHaveLength(1)
    expect(screen.queryByText(/Never/)).not.toBeInTheDocument()
  })
})
