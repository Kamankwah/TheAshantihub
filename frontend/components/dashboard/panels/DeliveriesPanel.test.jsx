import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import DeliveriesPanel from './DeliveriesPanel.jsx'
import { server } from '../../../mocks/server.js'

function renderPanel(orders) {
  server.use(
    http.get('http://localhost:8000/api/orders/owner/', () =>
      HttpResponse.json({ count: orders.length, next: null, previous: null, results: orders })),
  )
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}><DeliveriesPanel /></QueryClientProvider>)
}

const DOOR_TO_DOOR_ORDER = {
  id: 7, customer_name: 'Yaw Mensah', status: 'paid', delivery_status: 'processing',
  placed_at: '2026-10-05T09:30:00Z', owner_subtotal: '250.00',
  items: [{ id: 1, listing: 1, listing_name: 'Handwoven kente stole', quantity: 1 }],
  delivery_method: 'door_to_door', delivery_address: 'Bantama, Kumasi',
}

describe('DeliveriesPanel', () => {
  it("shows the customer's name and delivery address", async () => {
    renderPanel([DOOR_TO_DOOR_ORDER])
    expect(await screen.findByText(/Order #7 · Yaw Mensah/)).toBeInTheDocument()
    expect(screen.getByText(/Bantama, Kumasi/)).toBeInTheDocument()
  })

  it("never shows the customer's phone, even if the API sends one", async () => {
    renderPanel([{ ...DOOR_TO_DOOR_ORDER, delivery_phone: '0200000201' }])
    await screen.findByText(/Bantama, Kumasi/)
    expect(screen.queryByText(/0200000201/)).not.toBeInTheDocument()
  })
})
