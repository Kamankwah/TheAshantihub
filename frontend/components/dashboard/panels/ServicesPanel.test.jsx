import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import ServicesPanel from './ServicesPanel.jsx'
import { server } from '../../../mocks/server.js'

// Services tab: the 7E release state of a completed request, the server's
// own price and decline errors on the quote (4F and 1F), and a quote that is accepted.

const API = 'http://localhost:8000'
const request = (extra) => ({
  id: 7, listing_name: 'Home tailoring', customer_name: 'Yaa Buyer', status: 'completed',
  message: 'Please sew a dress', budget: '150.00', agreed_price: '150.00',
  created_at: '2026-10-01T10:00:00Z', progress_note: '', decline_reason: '',
  auto_accept_at: null, settled: false, problem_reported: false,
  ...extra,
})

function renderPanel(rows) {
  server.use(http.get(`${API}/api/services/requests/incoming/`, () => HttpResponse.json(rows)))
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <ServicesPanel />
    </QueryClientProvider>,
  )
}

describe('ServicesPanel release state', () => {
  it('test_completed_service_shows_the_servers_auto_accept_time', async () => {
    renderPanel([request({ auto_accept_at: '2026-10-05T14:30:00Z' })])
    const line = await screen.findByText(/The customer can accept now\./)
    expect(line.textContent).toMatch(/it is accepted automatically from .*14:30.* and your money is released\.$/)
    expect(line.textContent).not.toMatch(/Invalid/)
  })

  it('test_problem_reported_shows_on_hold_and_no_time', async () => {
    renderPanel([request({ problem_reported: true, auto_accept_at: '2026-10-05T14:30:00Z' })])
    const line = await screen.findByText('Payment on hold: a problem was reported. AshantiHub Support is checking it.')
    expect(line.textContent).not.toMatch(/Yaa|accepted automatically/)
    expect(screen.queryByText(/accepted automatically/)).not.toBeInTheDocument()
  })

  it('test_settled_says_settled', async () => {
    renderPanel([request({ settled: true })])
    expect(await screen.findByText('Payment settled. The amount is on the Money tab.')).toBeInTheDocument()
  })

  it('test_completed_without_a_sale_shows_no_payment_line', async () => {
    renderPanel([request({})])
    await screen.findByText('Home tailoring')
    expect(screen.queryByText(/Payment on hold|Payment settled|accepted automatically/)).not.toBeInTheDocument()
  })

  it('shows no payment line on a request that is not completed', async () => {
    renderPanel([request({ status: 'in_progress', settled: true })])
    await screen.findByText('Home tailoring')
    expect(screen.queryByText(/Payment settled/)).not.toBeInTheDocument()
  })
})

describe('ServicesPanel quote errors', () => {
  const openQuote = async () => {
    renderPanel([request({ status: 'requested', budget: null, agreed_price: null })])
    fireEvent.click(await screen.findByRole('button', { name: /Accept & quote/ }))
    fireEvent.change(screen.getByPlaceholderText('Your price (GHS)'), { target: { value: '0' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send quote' }))
  }

  it('test_quote_price_error_from_the_server_is_shown', async () => {
    server.use(http.post(`${API}/api/services/requests/:id/respond/`, () =>
      HttpResponse.json({ price: 'Enter a price in GH₵ above 0.00, like 150.00.' }, { status: 400 })))
    await openQuote()
    expect(await screen.findByText('Enter a price in GH₵ above 0.00, like 150.00.')).toBeInTheDocument()
  })

  it('test_other_failures_keep_the_generic_message', async () => {
    server.use(http.post(`${API}/api/services/requests/:id/respond/`, () =>
      new HttpResponse('boom', { status: 500 })))
    await openQuote()
    expect(await screen.findByText('Could not complete that action. Please try again.')).toBeInTheDocument()
  })
})

// Plan 1F: one requested service, with the respond endpoint per test.
const REQUEST = {
  id: 7, listing_name: 'Home tiling', customer_name: 'Yaw Boateng', created_at: '2026-10-20T09:00:00Z',
  message: 'Two rooms please', status: 'requested', budget: null, agreed_price: null,
}

function renderQuotePanel({ respond } = {}) {
  let incomingCalls = 0
  server.use(
    http.get(`${API}/api/listings/mine/`, () => HttpResponse.json([])),
    http.get(`${API}/api/services/requests/incoming/`, () => {
      incomingCalls += 1
      return HttpResponse.json([REQUEST])
    }),
    http.post(`${API}/api/services/requests/:id/respond/`, respond),
  )
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={queryClient}><ServicesPanel /></QueryClientProvider>)
  return { incomingCalls: () => incomingCalls }
}

describe('ServicesPanel quote and decline', () => {
  it("a refused quote shows the server's price message", async () => {
    let sent
    renderQuotePanel({
      respond: async ({ request }) => {
        sent = await request.json()
        return HttpResponse.json({ price: 'Enter a price in GH₵ above 0.00, like 150.00.' }, { status: 400 })
      },
    })
    fireEvent.click(await screen.findByText(/Accept & quote/))
    fireEvent.change(screen.getByPlaceholderText('Your price (GHS)'), { target: { value: ' 0 ' } })
    fireEvent.click(screen.getByText('Send quote'))
    expect(await screen.findByText('Enter a price in GH₵ above 0.00, like 150.00.')).toBeInTheDocument()
    expect(sent).toEqual({ action: 'accept', price: '0' })
  })

  it('a decline refusal shows the server detail', async () => {
    renderQuotePanel({
      respond: () => HttpResponse.json({ detail: 'This request was already answered.' }, { status: 409 }),
    })
    fireEvent.click(await screen.findByText(/Decline/))
    fireEvent.click(screen.getByText('Confirm decline'))
    expect(await screen.findByText('This request was already answered.')).toBeInTheDocument()
  })

  it('a quote that is accepted closes the form and refetches', async () => {
    const view = renderQuotePanel({ respond: () => HttpResponse.json({ id: 7, status: 'accepted' }) })
    fireEvent.click(await screen.findByText(/Accept & quote/))
    fireEvent.change(screen.getByPlaceholderText('Your price (GHS)'), { target: { value: '150.00' } })
    fireEvent.click(screen.getByText('Send quote'))
    await waitFor(() => expect(screen.queryByPlaceholderText('Your price (GHS)')).not.toBeInTheDocument())
    await waitFor(() => expect(view.incomingCalls()).toBe(2))
  })
})
