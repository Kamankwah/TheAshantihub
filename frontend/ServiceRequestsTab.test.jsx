import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, describe, expect, it } from 'vitest'
import { server } from './mocks/server.js'
import { gatedOpening } from './mocks/opening.js'
import { setStoredAuth } from './apiClient.js'
import { ServiceRequestsTab } from './App.jsx'

// Ruling R35: the service-request Pay button follows the one buy-disabled rule
// (useCanBuy) and a server refusal before opening (403 not_open) shows the
// server's own message, not "Payment went through…".
const ACCEPTED = [{ id: 5, listing_name: 'Braids at Asafo', status: 'accepted', message: 'Box braids', agreed_price: '120.00' }]

// A stand-in for the simulated payment modal: pays at once when opened.
function InstantPay({ onSuccess }) {
  return <button onClick={onSuccess}>Simulate paid</button>
}

function renderTab() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <ServiceRequestsTab PaymentComponent={InstantPay} />
    </QueryClientProvider>,
  )
}

afterEach(() => setStoredAuth(null))

describe('ServiceRequestsTab — Pay before the marketplace opens', () => {
  it('is disabled with "Opens <D Mon>" for a customer who cannot buy yet', async () => {
    setStoredAuth({ token: 't', account_type: 'customer' })
    server.use(
      gatedOpening({ opensAt: '2026-11-06T06:00:00Z', serverNow: '2026-11-01T06:00:00Z' }),
      http.get('http://localhost:8000/api/accounts/me/', () => HttpResponse.json({ id: 4, can_buy: false })),
      http.get('http://localhost:8000/api/services/requests/mine/', () => HttpResponse.json(ACCEPTED)),
    )
    renderTab()
    const btn = await screen.findByRole('button', { name: 'Opens 6 Nov' })
    expect(btn).toBeDisabled()
    fireEvent.click(btn)
    expect(screen.queryByText('Simulate paid')).not.toBeInTheDocument()
  })

  it('shows the server detail when the pay call is refused with not_open', async () => {
    setStoredAuth({ token: 't', account_type: 'customer' })
    server.use(
      http.get('http://localhost:8000/api/services/requests/mine/', () => HttpResponse.json(ACCEPTED)),
      http.post('http://localhost:8000/api/services/requests/:id/pay/', () => HttpResponse.json(
        { detail: 'The marketplace opens on 6 Nov 2026 at 06:00.', code: 'not_open', opens_at: '2026-11-06T06:00:00+00:00' },
        { status: 403 },
      )),
    )
    renderTab()
    fireEvent.click(await screen.findByRole('button', { name: /Pay GHS 120.00 to start/ }))
    fireEvent.click(screen.getByText('Simulate paid'))
    expect(await screen.findByText('The marketplace opens on 6 Nov 2026 at 06:00.')).toBeInTheDocument()
    expect(screen.queryByText(/Payment went through/)).not.toBeInTheDocument()
  })

  it('keeps the old message for any other failure', async () => {
    server.use(
      http.get('http://localhost:8000/api/services/requests/mine/', () => HttpResponse.json(ACCEPTED)),
      http.post('http://localhost:8000/api/services/requests/:id/pay/', () => HttpResponse.json({ detail: 'boom' }, { status: 500 })),
    )
    renderTab()
    fireEvent.click(await screen.findByRole('button', { name: /Pay GHS 120.00 to start/ }))
    fireEvent.click(screen.getByText('Simulate paid'))
    await waitFor(() => expect(screen.getByText(/Payment went through but we couldn't start the job/)).toBeInTheDocument())
  })
})
