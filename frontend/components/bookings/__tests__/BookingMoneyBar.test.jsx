import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { server } from '../../../mocks/server.js'
import BookingMoneyBar from '../BookingMoneyBar.jsx'

const API = 'http://localhost:8000'
const money = (extra = {}) => ({
  sale: 12, release_at: '2099-10-12T14:00:00Z', released_at: null, accepted_at: null, refunded: null, refunded_whole: false, problem: null,
  policy: { policy: 'moderate', tiers: [[120, 10000], [24, 5000]], text: 'Full refund until 5 days before the start, half until 24 hours before.' },
  start: '2099-10-10T14:00:00Z', can_cancel: true, can_report: true, ...extra,
})
const mount = (props, client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) => render(
  <QueryClientProvider client={client}>
    <BookingMoneyBar kind="stay" money={money()} cancelPath="/api/bookings/5/cancel/" reportPath="/api/ledger/bookings/12/report-problem/"
      about={{ name: 'Ashanti Lodge' }} onChanged={() => {}} onContactSupport={() => {}} {...props} />
  </QueryClientProvider>,
)

describe('BookingMoneyBar', () => {
  it('renders nothing without a money block', () => {
    const { container } = mount({ money: null })
    expect(container).toBeEmptyDOMElement()
    const again = mount({ money: undefined })
    expect(again.container).toBeEmptyDOMElement()
  })

  it('renders nothing when the ledger is off', async () => {
    server.use(http.get(`${API}/api/ledger/booking-terms/`, () => HttpResponse.json({ enabled: false, policies: {} })))
    const { container } = mount()
    await waitFor(() => expect(container).toBeEmptyDOMElement())
  })

  it('shows the policy, the release time and both buttons before the stay', async () => {
    mount()
    expect(await screen.findByText('Moderate: Full refund until 5 days before the start, half until 24 hours before.')).toBeInTheDocument()
    expect(screen.getByText(/Free cancellation until/)).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(/The host is paid on .* unless you report a problem before then\./)
    expect(screen.getByRole('button', { name: 'Cancel booking' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Report a problem' })).toBeInTheDocument()
  })

  it('offers Report but not Cancel once the release time has passed', () => {
    mount({ money: money({ release_at: '2020-01-01T00:00:00Z', can_cancel: false }) })
    expect(screen.getByRole('status')).toHaveTextContent('The host is due to be paid now.')
    expect(screen.queryByRole('button', { name: 'Cancel booking' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Report a problem' })).toBeInTheDocument()
  })

  it('hides Report after Support settled the problem', () => {
    mount({ money: money({ problem: 'closed', can_cancel: false, can_report: false }) })
    expect(screen.getByRole('status')).toHaveTextContent('Support has settled the problem you reported.')
    expect(screen.queryByRole('button', { name: 'Report a problem' })).toBeNull()
    expect(screen.queryByText(/Only AshantiHub Support/)).toBeNull()
  })

  it('shows the paid line and Contact Support after release', () => {
    const onContactSupport = vi.fn()
    mount({ money: money({ released_at: '2026-10-12T14:00:00Z', can_cancel: false, can_report: false }), onContactSupport })
    expect(screen.getByRole('status')).toHaveTextContent('The host was paid on')
    expect(screen.getByText('If something is wrong, contact AshantiHub Support.')).toBeInTheDocument()
    expect(screen.queryByText('Moderate: Full refund until 5 days before the start, half until 24 hours before.')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Contact AshantiHub Support' }))
    expect(onContactSupport).toHaveBeenCalled()
  })

  it('offers Contact Support, not Cancel, for a sale with no policy', () => {
    mount({ money: money({ policy: null, can_cancel: false, can_report: false }) })
    expect(screen.getByText('Only AshantiHub Support can cancel this booking.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Contact AshantiHub Support' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancel booking' })).toBeNull()
  })

  it('omits the Contact button without the prop', () => {
    mount({ money: money({ policy: null, can_cancel: false, can_report: false }), onContactSupport: undefined })
    expect(screen.getByText('Only AshantiHub Support can cancel this booking.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Contact AshantiHub Support' })).toBeNull()
  })

  it('passes the listing name to onContactSupport', () => {
    const onContactSupport = vi.fn()
    mount({ money: money({ policy: null, can_cancel: false, can_report: false }), onContactSupport })
    fireEvent.click(screen.getByRole('button', { name: 'Contact AshantiHub Support' }))
    expect(onContactSupport).toHaveBeenCalledWith({ name: 'Ashanti Lodge' })
  })

  it('reports to the sale path and shows the on-hold confirmation', async () => {
    let body
    server.use(http.post(`${API}/api/ledger/bookings/12/report-problem/`, async ({ request }) => { body = await request.json(); return HttpResponse.json({ dispute_id: 3 }, { status: 201 }) }))
    const onChanged = vi.fn()
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const spy = vi.spyOn(client, 'invalidateQueries')
    mount({ onChanged }, client)
    fireEvent.click(screen.getByRole('button', { name: 'Report a problem' }))
    fireEvent.change(screen.getByLabelText('What went wrong?'), { target: { value: 'The room was not ready' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send report' }))
    expect(await screen.findByText('Problem reported. AshantiHub Support has been told, and the payment to the host is on hold until it is settled.')).toBeInTheDocument()
    expect(body).toEqual({ reason: 'The room was not ready' })
    expect(spy).toHaveBeenCalledWith({ queryKey: ['wallet'] })
    expect(onChanged).toHaveBeenCalledTimes(1)
  })

  it('shows the cancel result from the server and refreshes the list', async () => {
    server.use(
      http.get(`${API}/api/ledger/bookings/12/cancel-quote/`, () => HttpResponse.json({ refund: '150.00', whole: false })),
      http.post(`${API}/api/bookings/5/cancel/`, () => HttpResponse.json({ id: 5, wallet_refund: '140.00' })),
    )
    const onChanged = vi.fn()
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const spy = vi.spyOn(client, 'invalidateQueries')
    mount({ onChanged }, client)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel booking' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel booking' }))
    expect(await screen.findByText('Cancelled. GH₵ 140.00 went back to your AshantiHub wallet.')).toBeInTheDocument()
    expect(spy).toHaveBeenCalledWith({ queryKey: ['wallet'] })
    expect(onChanged).toHaveBeenCalledTimes(1)
  })

  it('says no refund for a no-refunds ticket policy and offers no Cancel', () => {
    mount({ kind: 'tickets', money: money({ policy: { policy: 'none', tiers: [], text: 'No refunds after purchase, except for a cancelled event.' }, can_cancel: false }) })
    expect(screen.getByText('No refunds after purchase, except for a cancelled event.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Cancel/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'Report a problem' })).toBeInTheDocument()
  })

  it('labels the cancel button for tickets', () => {
    mount({ kind: 'tickets', ticketCount: 2 })
    expect(screen.getByRole('button', { name: 'Cancel tickets' })).toBeInTheDocument()
  })
})
