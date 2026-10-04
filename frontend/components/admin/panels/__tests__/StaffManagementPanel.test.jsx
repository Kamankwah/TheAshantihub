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
