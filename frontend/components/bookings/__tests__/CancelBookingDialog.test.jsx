import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { server } from '../../../mocks/server.js'
import CancelBookingDialog from '../CancelBookingDialog.jsx'

const API = 'http://localhost:8000'
const CANCEL = '/api/bookings/5/cancel/'
const money = (extra = {}) => ({
  sale: 12, release_at: '2026-10-12T14:00:00Z', released_at: null, accepted_at: null, refunded: null, refunded_whole: false, problem: null,
  policy: { policy: 'moderate', tiers: [[120, 10000], [24, 5000]], text: 'Full refund until 5 days before the start, half until 24 hours before.' },
  start: '2099-10-10T14:00:00Z', can_cancel: true, can_report: true, ...extra,
})
const quote = (body, status = 200) => server.use(http.get(`${API}/api/ledger/bookings/12/cancel-quote/`, () => HttpResponse.json(body, { status })))
const mount = (props) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <CancelBookingDialog kind="stay" money={money()} cancelPath={CANCEL} onDone={() => {}} onClose={() => {}} {...props} />
  </QueryClientProvider>,
)

describe('CancelBookingDialog', () => {
  it('shows the snapshot policy text with the booking-terms label', async () => {
    quote({ refund: '150.00', whole: false })
    mount()
    expect(screen.getByRole('dialog', { name: 'Cancel this booking' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Cancel this booking?' })).toBeInTheDocument()
    expect(await screen.findByText('Moderate: Full refund until 5 days before the start, half until 24 hours before.')).toBeInTheDocument()
    expect(await screen.findByText(/Free cancellation until/)).toBeInTheDocument()
  })

  it('shows the server quote and that the host keeps the rest', async () => {
    quote({ refund: '150.00', whole: false })
    mount()
    expect(await screen.findByText('GH₵ 150.00')).toBeInTheDocument()
    expect(screen.getByText(/goes back to your AshantiHub wallet\./)).toBeInTheDocument()
    expect(screen.getByText('The host keeps the rest under this policy.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel booking' })).toBeInTheDocument()
  })

  it('shows no amount and no confirm button while the quote loads or is refused', async () => {
    server.use(http.get(`${API}/api/ledger/bookings/12/cancel-quote/`, () => HttpResponse.json({ detail: 'Report a problem instead.', code: 'x' }, { status: 409 })))
    mount()
    expect(screen.getByText('Checking what you get back…')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancel booking' })).toBeNull()
    expect(await screen.findByText('Report a problem instead.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancel booking' })).toBeNull()
    expect(screen.queryByText(/GH₵/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
  })

  it('offers Try again when the quote fails', async () => {
    let calls = 0
    server.use(http.get(`${API}/api/ledger/bookings/12/cancel-quote/`, () => {
      calls += 1
      return calls === 1 ? new HttpResponse(null, { status: 500 }) : HttpResponse.json({ refund: '150.00', whole: true })
    }))
    mount()
    expect(await screen.findByText('Could not check what you get back. Try again.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancel booking' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('GH₵ 150.00')).toBeInTheDocument()
    expect(screen.queryByText(/keeps the rest/)).toBeNull()
  })

  it('posts the cancel once on a double click', async () => {
    quote({ refund: '150.00', whole: false })
    let posts = 0
    const onDone = vi.fn()
    server.use(http.post(`${API}${CANCEL}`, async () => { posts += 1; await new Promise((r) => setTimeout(r, 50)); return HttpResponse.json({ id: 5, wallet_refund: '150.00' }) }))
    mount({ onDone })
    const button = await screen.findByRole('button', { name: 'Cancel booking' })
    fireEvent.click(button)
    fireEvent.click(button)
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(posts).toBe(1)
  })

  it('shows the amount the cancel returned, not the quote', async () => {
    quote({ refund: '300.00', whole: true })
    const onDone = vi.fn()
    server.use(http.post(`${API}${CANCEL}`, () => HttpResponse.json({ id: 5, wallet_refund: '150.00' })))
    mount({ onDone })
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel booking' }))
    await waitFor(() => expect(onDone).toHaveBeenCalledWith({ refunded: '150.00' }))
  })

  it('shows the server detail when the cancel is refused', async () => {
    quote({ refund: '150.00', whole: false })
    server.use(http.post(`${API}${CANCEL}`, () => HttpResponse.json({ detail: 'Too late to cancel.' }, { status: 409 })))
    const onDone = vi.fn()
    mount({ onDone })
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel booking' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Too late to cancel.')
    expect(onDone).not.toHaveBeenCalled()
  })

  it('names how many tickets it cancels', async () => {
    quote({ refund: '40.00', whole: true })
    const { unmount } = render(
      <QueryClientProvider client={new QueryClient()}>
        <CancelBookingDialog kind="tickets" money={money()} cancelPath="/x/" ticketCount={3} onDone={() => {}} onClose={() => {}} />
      </QueryClientProvider>,
    )
    expect(screen.getByRole('heading', { name: 'Cancel all 3 tickets in this purchase?' })).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Cancel tickets' })).toBeInTheDocument()
    unmount()
    mount({ kind: 'tickets', ticketCount: 1 })
    expect(screen.getByRole('heading', { name: 'Cancel this ticket?' })).toBeInTheDocument()
  })

  it('in ledger-off mode asks no quote and says no refund is made in the app', async () => {
    let asked = false
    server.use(http.get(`${API}/api/ledger/bookings/:id/cancel-quote/`, () => { asked = true; return HttpResponse.json({ refund: '1.00', whole: true }) }))
    const onClose = vi.fn()
    mount({ money: null, paid: true, onClose })
    expect(screen.getByText('This cancels your booking and frees the dates.')).toBeInTheDocument()
    expect(screen.getByText('No refund is made in the app. Contact AshantiHub Support about your payment.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel booking' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'Keep it' }))
    expect(onClose).toHaveBeenCalled()
    await new Promise((r) => setTimeout(r, 50))
    expect(asked).toBe(false)
  })

  it('never renders tel or wa.me links', async () => {
    quote({ refund: '150.00', whole: false })
    const { container } = render(
      <QueryClientProvider client={new QueryClient()}>
        <CancelBookingDialog kind="service" money={money()} cancelPath="/x/" onDone={() => {}} onClose={() => {}} />
      </QueryClientProvider>,
    )
    await screen.findByText('GH₵ 150.00')
    expect(screen.getByRole('heading', { name: 'Cancel this service?' })).toBeInTheDocument()
    expect(container.querySelector('a[href^="tel:"], a[href*="wa.me"]')).toBeNull()
  })
})
