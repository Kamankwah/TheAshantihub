import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { server } from './mocks/server.js'
import { gatedOpening } from './mocks/opening.js'
import { setStoredAuth } from './apiClient.js'
import { ServiceRequestsTab } from './App.jsx'

// Ruling R35: the service-request Pay button follows the one buy-disabled rule
// (useCanBuy) and a server refusal before opening (403 not_open) shows the
// server's own message, not "Payment went through…".
const ACCEPTED = [{ id: 5, listing_name: 'Braids at Asafo', status: 'accepted', message: 'Box braids', agreed_price: '120.00' }]

// A stand-in for the simulated payment modal: pays at once when opened.
function InstantPay({ onSuccess, processing }) {
  return <button onClick={onSuccess} data-processing={processing === undefined ? 'none' : processing}>Simulate paid</button>
}

const API = 'http://localhost:8000'
const ledgerOff = () => http.get(`${API}/api/wallet/`, () => HttpResponse.json({ code: 'ledger_off', detail: 'off' }, { status: 409 }))
const ledgerOn = (balance = '500.00') => http.get(`${API}/api/wallet/`, () => HttpResponse.json({ kind: 'customer', balance }))
const listAccepted = () => http.get(`${API}/api/services/requests/mine/`, () => HttpResponse.json(ACCEPTED))
const quote = (pp = '1.80') => http.get(`${API}/api/wallet/processing/`, ({ request }) => {
  const amount = new URL(request.url).searchParams.get('amount')
  return HttpResponse.json({ amount, payment_processing: pp, you_pay: '121.80', provider: 'simulated' })
})

// Old cases run with the ledger off, so the flow is the one before wallets.
beforeEach(() => server.use(ledgerOff()))

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

describe('ServiceRequestsTab — paying by method with the server charge', () => {
  it('ledger off: the pay flow and body are unchanged', async () => {
    let body
    server.use(
      listAccepted(),
      http.post(`${API}/api/services/requests/:id/pay/`, async ({ request }) => { body = await request.json(); return HttpResponse.json({ id: 5, status: 'in_progress' }) }),
    )
    renderTab()
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: /Pay GHS 120.00 to start/ }))
    expect(screen.getByText('Simulate paid')).toHaveAttribute('data-processing', 'none')
    fireEvent.click(screen.getByText('Simulate paid'))
    await waitFor(() => expect(body).toEqual({}))
  })

  it("momo passes the server's processing to the payment modal and posts payment_method momo", async () => {
    let body
    server.use(
      ledgerOn(), listAccepted(), quote('1.80'),
      http.post(`${API}/api/services/requests/:id/pay/`, async ({ request }) => { body = await request.json(); return HttpResponse.json({ id: 5, status: 'in_progress' }) }),
    )
    renderTab()
    const btn = await screen.findByRole('button', { name: /Pay GHS 120.00 to start/ })
    await waitFor(() => expect(btn).toBeEnabled())
    fireEvent.click(btn)
    expect(screen.getByText('Simulate paid')).toHaveAttribute('data-processing', '1.80')
    fireEvent.click(screen.getByText('Simulate paid'))
    await waitFor(() => expect(body).toEqual({ payment_method: 'momo' }))
  })

  it('wallet pays once without opening the payment modal', async () => {
    const bodies = []
    server.use(
      ledgerOn(), listAccepted(),
      http.post(`${API}/api/services/requests/:id/pay/`, async ({ request }) => {
        bodies.push(await request.json())
        await new Promise((r) => setTimeout(r, 50))
        return HttpResponse.json({ id: 5, status: 'in_progress', payment_processing: '0.00' })
      }),
    )
    renderTab()
    fireEvent.click(await screen.findByLabelText(/AshantiHub wallet/))
    const btn = await screen.findByRole('button', { name: 'Pay GH₵ 120.00 from your AshantiHub wallet' })
    fireEvent.click(btn)
    fireEvent.click(btn)
    expect(screen.queryByText('Simulate paid')).not.toBeInTheDocument()
    expect(await screen.findByText('Paid. The job can start.')).toBeInTheDocument()
    expect(bodies).toEqual([{ payment_method: 'wallet' }])
    expect(screen.queryByText(/Payment processing GH/)).not.toBeInTheDocument()
  })

  it('insufficient funds shows the server text', async () => {
    server.use(
      ledgerOn(), listAccepted(),
      http.post(`${API}/api/services/requests/:id/pay/`, () => HttpResponse.json(
        { detail: 'Your wallet balance is too low.', code: 'insufficient_funds' }, { status: 409 })),
    )
    renderTab()
    fireEvent.click(await screen.findByLabelText(/AshantiHub wallet/))
    fireEvent.click(await screen.findByRole('button', { name: /from your AshantiHub wallet/ }))
    expect(await screen.findByText('Your wallet balance is too low.')).toBeInTheDocument()
    expect(screen.queryByText(/Payment went through/)).not.toBeInTheDocument()
  })

  it('a redirect answer goes to checkout_url', async () => {
    server.use(
      ledgerOn(), listAccepted(),
      http.post(`${API}/api/services/requests/:id/pay/`, () => HttpResponse.json({ mode: 'redirect', checkout_url: 'https://pay.example/c/9' })),
    )
    const original = window.location
    Object.defineProperty(window, 'location', { configurable: true, value: { href: 'http://localhost/' } })
    try {
      renderTab()
      fireEvent.click(await screen.findByLabelText(/AshantiHub wallet/))
      fireEvent.click(await screen.findByRole('button', { name: /from your AshantiHub wallet/ }))
      await waitFor(() => expect(window.location.href).toBe('https://pay.example/c/9'))
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: original })
    }
  })

  it("the paid line shows the server's processing charge", async () => {
    server.use(
      ledgerOn(), listAccepted(), quote('1.80'),
      http.post(`${API}/api/services/requests/:id/pay/`, () => HttpResponse.json({ id: 5, status: 'in_progress', payment_processing: '1.80' })),
    )
    renderTab()
    const btn = await screen.findByRole('button', { name: /Pay GHS 120.00 to start/ })
    await waitFor(() => expect(btn).toBeEnabled())
    fireEvent.click(btn)
    fireEvent.click(screen.getByText('Simulate paid'))
    expect(await screen.findByText('Paid. The job can start.')).toBeInTheDocument()
    expect(screen.getByText('Payment processing GH₵ 1.80')).toBeInTheDocument()
  })
})
