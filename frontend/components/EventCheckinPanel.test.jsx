import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import EventCheckinPanel from './EventCheckinPanel.jsx'
import { server } from '../mocks/server.js'

function renderPanel(tickets) {
  server.use(
    http.get('http://localhost:8000/api/events/9/tickets/checkin-list/', () =>
      HttpResponse.json({ count: tickets.length, next: null, previous: null, results: tickets })),
  )
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}><EventCheckinPanel eventId={9} /></QueryClientProvider>)
}

const TICKET = {
  id: 1, code: 'ad3126f8cbc4', delivery_method: 'digital', delivered_at: null, escrow_status: 'held',
  ticket_type_name: 'Regular', purchased_by_name: 'Yaw Mensah',
}

describe('EventCheckinPanel', () => {
  it('identifies each ticket by code and holder name', async () => {
    renderPanel([TICKET])
    expect(await screen.findByText(/ad3126f8cbc4 · Regular/)).toBeInTheDocument()
    expect(screen.getByText(/Yaw Mensah/)).toBeInTheDocument()
  })

  it("never shows the buyer's phone to the organizer, even if the API sends one", async () => {
    renderPanel([{ ...TICKET, purchased_by_phone: '+233200552222' }])
    await screen.findByText(/Yaw Mensah/)
    expect(screen.queryByText(/233200552222/)).not.toBeInTheDocument()
  })
})
