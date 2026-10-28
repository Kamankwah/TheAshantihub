import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setSudoHandler } from '../../../../apiClient.js'
import { server } from '../../../../mocks/server.js'
import VerificationCallsPanel from '../VerificationCallsPanel.jsx'

const ORDERS = 'http://localhost:8000/api/ledger/orders/awaiting-verification/'
const ORDER_POST = 'http://localhost:8000/api/ledger/orders/:id/verification/'
const wrap = (ui) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>)
const envelope = (results, count = results.length, next = null) => HttpResponse.json({ count, next, previous: null, results })
const support = { user: { role: 'support' }, hasPermission: (c) => c === 'orders.verify' }
const admin = { user: { role: 'super_admin' }, hasPermission: () => true }
const row = (over = {}) => ({
  order_id: 41, placed_at: '2026-10-20T10:00:00Z', due_by: '2026-10-22T10:00:00Z', overdue: false, delivery_method: 'delivery',
  customer_name: 'Ama Mensah', customer_phone: '+233241112233',
  items: [{ name: 'Solar lamp', quantity: 2, business: 'Bright Stores' }],
  customer_confirmed: false, outcome: '', outcome_note: '', released: false, ...over,
})
const TICK = 'I spoke to the customer and they confirmed they received it'
const MATCHES = 'Matches: release the money now'
const NO_MATCH = 'Does not match: open a dispute'
const UNREACHED = 'Could not reach the customer'

async function openForm() {
  fireEvent.click(await screen.findByRole('button', { name: 'Record the call' }))
  return screen.findByRole('radio', { name: MATCHES })
}

afterEach(() => setSudoHandler(null))

describe('Verification calls: orders', () => {
  it('orders tab lists what Support needs on the call with the full phone as a call link', async () => {
    server.use(http.get(ORDERS, () => envelope([
      row(),
      row({ order_id: 42, delivery_method: 'store_pickup', overdue: true, customer_confirmed: true, customer_name: 'Kofi Boateng', customer_phone: '0200000000', outcome: 'unreachable', outcome_note: 'No answer', items: [{ name: 'Rice 5kg', quantity: 1, business: 'Fresh Mart' }] }),
    ])))
    wrap(<VerificationCallsPanel auth={support} />)
    expect(await screen.findByText('Order #41')).toBeInTheDocument()
    expect(screen.getByText('A product order is paid to the business only after this call.')).toBeInTheDocument()
    expect(screen.getByText('Ama Mensah')).toBeInTheDocument()
    const link = screen.getByRole('link', { name: 'Call +233241112233' })
    expect(link).toHaveAttribute('href', 'tel:+233241112233')
    expect(screen.getByText('Delivered')).toBeInTheDocument()
    expect(screen.getByText('Collected at the office')).toBeInTheDocument()
    expect(screen.getByText('2 × Solar lamp, Bright Stores')).toBeInTheDocument()
    expect(screen.getAllByText('Overdue')).toHaveLength(1)
    expect(screen.getAllByText(/^Due by /)).toHaveLength(2)
    expect(screen.getAllByText('Customer confirmed receipt')).toHaveLength(1)
    expect(screen.getByText(/Last call: .*No answer/)).toBeInTheDocument()
  })

  it('matches needs the spoke-to-customer tick when receipt is not yet confirmed', async () => {
    server.use(http.get(ORDERS, () => envelope([row()])))
    wrap(<VerificationCallsPanel auth={support} />)
    fireEvent.click(await openForm())
    expect(screen.getByText('This pays the business now. You will be asked for your password.')).toBeInTheDocument()
    const submit = screen.getByRole('button', { name: 'Submit' })
    expect(submit).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox', { name: TICK }))
    expect(submit).toBeEnabled()
  })

  it('the tick is never pre-ticked', async () => {
    server.use(http.get(ORDERS, () => envelope([row()])))
    wrap(<VerificationCallsPanel auth={support} />)
    fireEvent.click(await openForm())
    expect(screen.getByRole('checkbox', { name: TICK })).not.toBeChecked()
  })

  it('matches posts once and is retried after the password prompt', async () => {
    const bodies = []
    let attempts = 0
    server.use(
      http.get(ORDERS, () => envelope([row()])),
      http.post(ORDER_POST, async ({ request }) => {
        attempts += 1
        bodies.push(await request.json())
        if (attempts === 1) return HttpResponse.json({ detail: 'Re-enter your password to continue.', code: 'sudo_required' }, { status: 403 })
        return HttpResponse.json({ order: 41, outcome: 'matches', dispute_id: null, released: true })
      }),
    )
    const sudo = vi.fn(async () => true)
    setSudoHandler(sudo)
    wrap(<VerificationCallsPanel auth={support} />)
    fireEvent.click(await openForm())
    fireEvent.click(screen.getByRole('checkbox', { name: TICK }))
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    expect(await screen.findByText('Released to the business.')).toBeInTheDocument()
    expect(sudo).toHaveBeenCalledTimes(1)
    expect(attempts).toBe(2)
    expect(bodies[1]).toEqual({ outcome: 'matches', note: '', customer_confirmed_by_phone: true })
  })

  it('does not match requires a note and reports the dispute number', async () => {
    const bodies = []
    server.use(
      http.get(ORDERS, () => envelope([row()])),
      http.post(ORDER_POST, async ({ request }) => { bodies.push(await request.json()); return HttpResponse.json({ order: 41, outcome: 'does_not_match', dispute_id: 77, released: false }) }),
    )
    wrap(<VerificationCallsPanel auth={support} />)
    await openForm()
    fireEvent.click(screen.getByRole('radio', { name: NO_MATCH }))
    const submit = screen.getByRole('button', { name: 'Submit' })
    expect(submit).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Note'), { target: { value: '   ' } })
    expect(submit).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Note'), { target: { value: ' Customer got the wrong item ' } })
    fireEvent.click(submit)
    expect(await screen.findByText('Dispute #77 opened.')).toBeInTheDocument()
    expect(bodies).toEqual([{ outcome: 'does_not_match', note: 'Customer got the wrong item' }])
  })

  it('could not reach records and keeps the row', async () => {
    let lists = 0
    server.use(
      http.get(ORDERS, () => { lists += 1; return envelope([row()]) }),
      http.post(ORDER_POST, () => HttpResponse.json({ order: 41, outcome: 'unreachable', dispute_id: null, released: false })),
    )
    wrap(<VerificationCallsPanel auth={support} />)
    await openForm()
    fireEvent.click(screen.getByRole('radio', { name: UNREACHED }))
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    expect(await screen.findByText('Recorded. It stays on the list.')).toBeInTheDocument()
    await waitFor(() => expect(lists).toBeGreaterThan(1))
    expect(screen.getByText('Order #41')).toBeInTheDocument()
  })

  it('unreachable never claims a dispute even when the answer carries an old dispute id', async () => {
    server.use(
      http.get(ORDERS, () => envelope([row()])),
      http.post(ORDER_POST, () => HttpResponse.json({ order: 41, outcome: 'unreachable', dispute_id: 9, released: false })),
    )
    wrap(<VerificationCallsPanel auth={support} />)
    await openForm()
    fireEvent.click(screen.getByRole('radio', { name: UNREACHED }))
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    expect(await screen.findByText('Recorded. It stays on the list.')).toBeInTheDocument()
    expect(screen.queryByText(/Dispute #9/)).not.toBeInTheDocument()
  })

  it('matches that did not release says Recorded, not a release', async () => {
    server.use(
      http.get(ORDERS, () => envelope([row({ customer_confirmed: true })])),
      http.post(ORDER_POST, () => HttpResponse.json({ order: 41, outcome: 'matches', dispute_id: null, released: false })),
    )
    wrap(<VerificationCallsPanel auth={support} />)
    await openForm()
    fireEvent.click(screen.getByRole('radio', { name: MATCHES }))
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    expect(await screen.findByText('Recorded.')).toBeInTheDocument()
    expect(screen.queryByText('Released to the business.')).not.toBeInTheDocument()
  })

  it('a double click on Submit against a slow answer posts once', async () => {
    let posts = 0
    server.use(
      http.get(ORDERS, () => envelope([row()])),
      http.post(ORDER_POST, async () => { posts += 1; await new Promise((r) => setTimeout(r, 80)); return HttpResponse.json({ order: 41, outcome: 'unreachable', dispute_id: null, released: false }) }),
    )
    wrap(<VerificationCallsPanel auth={support} />)
    await openForm()
    fireEvent.click(screen.getByRole('radio', { name: UNREACHED }))
    const submit = screen.getByRole('button', { name: 'Submit' })
    fireEvent.click(submit)
    fireEvent.click(submit)
    expect(await screen.findByText('Recorded. It stays on the list.')).toBeInTheDocument()
    expect(posts).toBe(1)
  })

  it('changing the outcome clears the spoke-to-customer tick', async () => {
    server.use(http.get(ORDERS, () => envelope([row()])))
    wrap(<VerificationCallsPanel auth={support} />)
    await openForm()
    fireEvent.click(screen.getByRole('radio', { name: MATCHES }))
    fireEvent.click(screen.getByRole('checkbox', { name: TICK }))
    fireEvent.click(screen.getByRole('radio', { name: UNREACHED }))
    fireEvent.click(screen.getByRole('radio', { name: MATCHES }))
    expect(screen.getByRole('checkbox', { name: TICK })).not.toBeChecked()
  })

  it('a 409 shows the server text and refetches the list', async () => {
    let lists = 0
    server.use(
      http.get(ORDERS, () => { lists += 1; return envelope([row()]) }),
      http.post(ORDER_POST, () => HttpResponse.json({ detail: 'This order was already checked.' }, { status: 409 })),
    )
    wrap(<VerificationCallsPanel auth={support} />)
    await openForm()
    fireEvent.click(screen.getByRole('radio', { name: UNREACHED }))
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('This order was already checked.')
    await waitFor(() => expect(lists).toBeGreaterThan(1))
  })

  it('ledger off shows one honest line', async () => {
    server.use(http.get(ORDERS, () => HttpResponse.json({ detail: "The ledger isn't switched on yet.", code: 'ledger_off' }, { status: 409 })))
    wrap(<VerificationCallsPanel auth={support} />)
    expect(await screen.findByText('Verification calls open when the ledger is switched on.')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it("opens the order on Support's Order status screen", async () => {
    server.use(http.get(ORDERS, () => envelope([row()])))
    const onNavigate = vi.fn()
    wrap(<VerificationCallsPanel auth={support} onNavigate={onNavigate} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Order #41' }))
    expect(onNavigate).toHaveBeenCalledWith('support-order-status', { order: 41 })
  })

  it('for a Super Admin the order number is text, not a link', async () => {
    server.use(http.get(ORDERS, () => envelope([row()])))
    wrap(<VerificationCallsPanel auth={admin} />)
    expect(await screen.findByText('Order #41')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Order #41' })).toBeNull()
  })
})

const BOOKINGS = 'http://localhost:8000/api/ledger/bookings/awaiting-verification/'
const BOOKING_POST = 'http://localhost:8000/api/ledger/bookings/:id/verification/'
const sale = (over = {}) => ({
  sale_id: 7, kind: 'service', label: 'service request #3', what: 'Plumbing repair', paid_at: '2026-10-20T08:00:00Z',
  handed_over_at: '2026-10-21T08:00:00Z', due_by: '2026-10-23T08:00:00Z', overdue: false, business: 'Pipe Pros',
  customer_name: 'Esi Owusu', customer_phone: '+233205556677', amount: '120.00', customer_confirmed: false,
  outcome: '', outcome_note: '', dispute_id: null, ...over,
})
const iso = (s) => new Date(s).toLocaleString('en-GH')
const openBookings = async () => fireEvent.click(await screen.findByRole('button', { name: 'Bookings' }))

describe('Verification calls: bookings', () => {
  it('bookings tab lists each sale with its release time from the server', async () => {
    server.use(http.get(BOOKINGS, () => envelope([
      sale(),
      sale({ sale_id: 8, kind: 'stay', what: 'Two nights, Kumasi', business: 'Lodge', amount: '900.50', dispute_id: 12, customer_confirmed: true }),
      sale({ sale_id: 9, kind: 'tickets', what: 'Jazz night', business: 'Events Co', amount: '60.00' }),
    ])))
    wrap(<VerificationCallsPanel auth={support} />)
    await openBookings()
    expect(await screen.findByText('Service')).toBeInTheDocument()
    expect(screen.getByText(/^Services, stays and tickets are paid to the business by themselves at the time shown, unless a dispute is open\. A call can release one earlier/)).toBeInTheDocument()
    expect(screen.getByText('Service')).toBeInTheDocument()
    expect(screen.getByText('Stay')).toBeInTheDocument()
    expect(screen.getByText('Tickets')).toBeInTheDocument()
    expect(screen.getByText('Plumbing repair')).toBeInTheDocument()
    expect(screen.getByText('Pipe Pros')).toBeInTheDocument()
    expect(screen.getByText('GH₵120.00')).toBeInTheDocument()
    expect(screen.getByText('GH₵900.50')).toBeInTheDocument()
    expect(screen.getAllByText(`Paid ${iso('2026-10-20T08:00:00Z')}`)).toHaveLength(3)
    expect(screen.getAllByText(`Received ${iso('2026-10-21T08:00:00Z')}`)).toHaveLength(3)
    expect(screen.getAllByText(`Releases by itself ${iso('2026-10-23T08:00:00Z')}`)).toHaveLength(3)
    expect(screen.getByText('Dispute #12')).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: 'Call +233205556677' })[0]).toHaveAttribute('href', 'tel:+233205556677')
    expect(screen.getAllByText('Customer confirmed')).toHaveLength(1)
  })

  it('a scanned ticket still needs the spoke-to-the-customer tick before matches', async () => {
    server.use(http.get(BOOKINGS, () => envelope([sale({ kind: 'tickets', what: 'Jazz night', customer_confirmed: true })])))
    wrap(<VerificationCallsPanel auth={support} />)
    await openBookings()
    expect(await screen.findByText("Scanned at the door (the organiser's scan)")).toBeInTheDocument()
    fireEvent.click(await openForm())
    const submit = screen.getByRole('button', { name: 'Submit' })
    expect(submit).toBeDisabled()
    const tick = screen.getByRole('checkbox', { name: TICK })
    expect(tick).not.toBeChecked()
    fireEvent.click(tick)
    expect(submit).toBeEnabled()
  })

  it('overdue reads as not released past its release time', async () => {
    server.use(http.get(BOOKINGS, () => envelope([sale({ overdue: true })])))
    wrap(<VerificationCallsPanel auth={support} />)
    await openBookings()
    expect(await screen.findByText('Not released: past its release time')).toBeInTheDocument()
    expect(screen.queryByText(/^Releases by itself/)).toBeNull()
  })

  it('matches posts to the booking verification url', async () => {
    const posts = []
    server.use(
      http.get(BOOKINGS, () => envelope([sale()])),
      http.post(BOOKING_POST, async ({ request, params }) => { posts.push([params.id, await request.json()]); return HttpResponse.json({ sale: 7, outcome: 'matches', dispute_id: null, released: true }) }),
    )
    setSudoHandler(async () => true)
    wrap(<VerificationCallsPanel auth={support} />)
    await openBookings()
    fireEvent.click(await openForm())
    fireEvent.click(screen.getByRole('checkbox', { name: TICK }))
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    expect(await screen.findByText('Released to the business.')).toBeInTheDocument()
    expect(posts).toEqual([['7', { outcome: 'matches', note: '', customer_confirmed_by_phone: true }]])
  })

  it('bookings tab ledger off shows the off line', async () => {
    server.use(http.get(BOOKINGS, () => HttpResponse.json({ detail: "The ledger isn't switched on yet.", code: 'ledger_off' }, { status: 409 })))
    wrap(<VerificationCallsPanel auth={support} />)
    await openBookings()
    expect(await screen.findByText('Verification calls open when the ledger is switched on.')).toBeInTheDocument()
  })

  it('bookings paging follows next', async () => {
    const pages = []
    server.use(http.get(BOOKINGS, ({ request }) => {
      const n = new URL(request.url).searchParams.get('page')
      pages.push(n)
      return envelope([sale({ sale_id: n === '2' ? 21 : 7, what: n === '2' ? 'Second page job' : 'Plumbing repair' })], 25, n === '2' ? null : `${BOOKINGS}?page=2`)
    }))
    wrap(<VerificationCallsPanel auth={support} />)
    await openBookings()
    expect(await screen.findByText('Plumbing repair')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByText('Second page job')).toBeInTheDocument()
    expect(pages).toEqual(['1', '2'])
  })
})
