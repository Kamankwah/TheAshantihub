import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { server } from '../../../../mocks/server.js'
import SupportTeamPanel from '../SupportTeamPanel.jsx'

const API = 'http://localhost:8000'
const team = (over = {}) => ({
  agents: [{ id: 1, name: 'Esi Nyarko', suspended: false, last_sign_in_at: '2026-10-07T08:02:00Z', calls_today: 3, report_today: 'submitted', last_report: { date: '2026-10-06', status: 'acknowledged' } }],
  queue: { open: 11, awaiting_reply: 7, oldest_waiting_seconds: 4500, closed_this_week: 5, closed_total: 40, by_starter: { customers: 6, business_owners: 3, guests: 2 } },
  ...over,
})
function renderPanel(data = team(), onNavigate = vi.fn()) {
  server.use(http.get(`${API}/api/operations/support-team/`, () => HttpResponse.json(data)))
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={queryClient}><SupportTeamPanel onNavigate={onNavigate} /></QueryClientProvider>)
  return onNavigate
}

describe('SupportTeamPanel', () => {
  it('shows the agents with what the system records and the queue as counts', async () => {
    renderPanel()
    const row = (await screen.findByText('Esi Nyarko')).closest('tr')
    expect(row).toHaveTextContent('3')
    expect(row).toHaveTextContent('Submitted')
    expect(row).toHaveTextContent('acknowledged')
    expect(within(screen.getByRole('group', { name: 'Open conversations' })).getByText('11')).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Open conversations' })).toHaveTextContent('6 customers · 3 business owners · 2 guests')
    expect(within(screen.getByRole('group', { name: 'Waiting for a reply' })).getByText('7')).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Longest wait' })).toHaveTextContent('1 h')
  })

  it('does not invent first-reply times, breaches or assignment', async () => {
    renderPanel()
    await screen.findByText('Esi Nyarko')
    expect(screen.getByText(/arrive with the Support phase/)).toBeInTheDocument()
    expect(screen.queryByText(/First reply today/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Past time limit/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /reassign|assign|take it/i })).not.toBeInTheDocument()
  })

  it('says so when nobody reports to the caller and sends invites to the Invite screen', async () => {
    const onNavigate = renderPanel(team({ agents: [] }))
    expect(await screen.findByText('No support agent reports to you yet.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Invite a support agent' }))
    expect(onNavigate).toHaveBeenCalledWith('my-team')
  })
})
