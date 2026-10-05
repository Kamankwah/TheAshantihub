import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import EventCheckinPanel from './EventCheckinPanel.jsx'
import { server } from '../mocks/server.js'

// The real scanner needs a camera; this stand-in "scans" a fixed code.
vi.mock('./QrScanner.jsx', () => ({
  default: ({ onDetected }) => <button onClick={() => onDetected('ad3126f8cbc4')}>Simulate scan</button>,
}))

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

  it('checks a ticket in from a scanned QR code, then closes the scanner', async () => {
    let posted = null
    server.use(http.post('http://localhost:8000/api/events/9/tickets/checkin/', async ({ request }) => {
      posted = await request.json()
      return HttpResponse.json({ ...TICKET, purchased_by_name: 'Yaw Mensah', ticket_type_name: 'Regular' })
    }))
    renderPanel([TICKET])
    fireEvent.click(await screen.findByRole('button', { name: '📷 Scan QR' }))
    fireEvent.click(screen.getByRole('button', { name: 'Simulate scan' }))

    expect(await screen.findByText('✓ Checked in Yaw Mensah — Regular')).toBeInTheDocument()
    expect(posted).toEqual({ code: 'ad3126f8cbc4' })
    expect(screen.queryByRole('button', { name: 'Simulate scan' })).not.toBeInTheDocument()
  })
})
