import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../../../mocks/server.js'
import SalesList from '../SalesList.jsx'

const API = 'http://localhost:8000'
const wrap = (ui) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}
const envelope = (results, next = null) => HttpResponse.json({ count: results.length, next, previous: null, results })

const orderRow = (over = {}) => ({
  kind: 'order', order: 41, reference: 'Order #41', placed_at: '2026-10-12T09:30:00Z',
  items: [{ name: 'Kente scarf', quantity: 2, line_total: '80.00' }, { name: 'Shea butter', quantity: 1, line_total: '25.00' }],
  item_subtotal: '105.00', refunded: '0.00', platform_fee: '5.25', free_delivery_promo: '0.00', net: '99.75',
  status: 'awaiting_call', status_label: 'Waiting for Support to confirm', handed_over: true, on_hold: false, released_at: null, ...over,
})
const bookingRow = (over = {}) => ({
  kind: 'booking', sale: 7, booking_kind: 'service', booking_kind_label: 'Service', reference: 'Booking #7',
  what: 'Hair braiding', placed_at: '2026-10-14T08:00:00Z', item_subtotal: '150.00', refunded: '0.00',
  platform_fee: '7.50', free_delivery_promo: '0.00', net: '142.50', status: 'awaiting_call',
  status_label: 'Waiting for the customer to accept, or the automatic release', on_hold: false,
  customer_accepted: false, release_at: '2026-10-16T14:05:00Z', released_at: null, ...over,
})

describe('SalesList', () => {
  it('test_orders_default_for_a_product_business_and_bookings_for_a_service_business', async () => {
    const hits = []
    server.use(
      http.get(`${API}/api/wallet/vendor/sales/`, () => { hits.push('sales'); return envelope([orderRow()]) }),
      http.get(`${API}/api/wallet/vendor/bookings/`, () => { hits.push('bookings'); return envelope([bookingRow()]) }),
    )
    const first = wrap(<SalesList businessKind="product" />)
    expect(await screen.findByText('Order #41')).toBeInTheDocument()
    expect(hits).toEqual(['sales'])
    first.unmount()
    hits.length = 0
    wrap(<SalesList businessKind="service" />)
    expect(await screen.findByText(/Booking #7/)).toBeInTheDocument()
    expect(hits).toEqual(['bookings'])
    fireEvent.click(screen.getByRole('button', { name: 'Orders' }))
    expect(await screen.findByText('Order #41')).toBeInTheDocument()
  })

  it('test_order_row_shows_items_fee_promo_and_you_get_as_sent', async () => {
    server.use(http.get(`${API}/api/wallet/vendor/sales/`, () => envelope([orderRow({ free_delivery_promo: '3.00', refunded: '10.00', net: '86.75' })])))
    wrap(<SalesList businessKind="product" />)
    expect(await screen.findByText('Order #41')).toBeInTheDocument()
    expect(screen.getByText('2026-10-12')).toBeInTheDocument()
    expect(screen.getByText(/Kente scarf × 2/)).toBeInTheDocument()
    expect(screen.getByText('GH₵ 80.00')).toBeInTheDocument()
    expect(screen.getByText('GH₵ 105.00').closest('[data-amount]')).not.toBeNull()
    expect(screen.getByText('GH₵ 5.25').closest('[data-amount]')).not.toBeNull()
    expect(screen.getByText('Free-delivery promo')).toBeInTheDocument()
    expect(screen.getByText('GH₵ 3.00')).toBeInTheDocument()
    expect(screen.getByText('Refunded', { selector: 'span' })).toBeInTheDocument()
    expect(screen.getByText('GH₵ 10.00')).toBeInTheDocument()
    expect(screen.getByText('You get')).toBeInTheDocument()
    expect(screen.getByText('GH₵ 86.75').closest('[data-amount]')).not.toBeNull()
  })

  it('test_zero_refund_and_zero_promo_lines_are_hidden', async () => {
    server.use(http.get(`${API}/api/wallet/vendor/sales/`, () => envelope([orderRow()])))
    wrap(<SalesList businessKind="product" />)
    expect(await screen.findByText('Order #41')).toBeInTheDocument()
    expect(screen.queryByText('Refunded', { selector: 'span' })).not.toBeInTheDocument()
    expect(screen.queryByText('Free-delivery promo')).not.toBeInTheDocument()
    expect(screen.getByText('Platform fee')).toBeInTheDocument()
  })

  it('test_a_negative_net_is_shown_with_a_minus_sign_as_sent', async () => {
    server.use(http.get(`${API}/api/wallet/vendor/sales/`, () => envelope([orderRow({ net: '-4.00' })])))
    wrap(<SalesList businessKind="product" />)
    expect(await screen.findByText('−GH₵ 4.00')).toBeInTheDocument()
  })

  it('test_status_chip_carries_the_servers_label', async () => {
    server.use(http.get(`${API}/api/wallet/vendor/sales/`, () => envelope([orderRow({ status: 'released', status_label: 'Paid out to you', released_at: '2026-10-13T10:00:00Z' })])))
    wrap(<SalesList businessKind="product" />)
    expect(await screen.findByText('Paid out to you')).toBeInTheDocument()
    expect(screen.getByText(/Released 2026-10-13/)).toBeInTheDocument()
  })

  it('test_status_filter_sends_the_status_and_resets_to_page_one', async () => {
    const urls = []
    server.use(http.get(`${API}/api/wallet/vendor/sales/`, ({ request }) => {
      urls.push(new URL(request.url).searchParams)
      return envelope([orderRow()], urls.length === 1 ? `${API}/api/wallet/vendor/sales/?page=2` : null)
    }))
    wrap(<SalesList businessKind="product" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Load more' }))
    await waitFor(() => expect(urls.some((u) => u.get('page') === '2')).toBe(true))
    urls.length = 0
    fireEvent.click(screen.getByRole('button', { name: 'Refunded' }))
    await waitFor(() => expect(urls.length).toBeGreaterThan(0))
    expect(urls[0].get('status')).toBe('refunded')
    expect(urls[0].get('page')).toBeNull()
    expect(urls.every((u) => u.get('page') === null)).toBe(true)
  })

  it('test_dates_are_sent_as_typed_and_blank_dates_are_not_sent', async () => {
    const urls = []
    server.use(http.get(`${API}/api/wallet/vendor/sales/`, ({ request }) => { urls.push(new URL(request.url).searchParams); return envelope([]) }))
    wrap(<SalesList businessKind="product" />)
    await waitFor(() => expect(urls.length).toBe(1))
    expect(urls[0].has('date_from')).toBe(false)
    expect(urls[0].has('date_to')).toBe(false)
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-10-01' } })
    await waitFor(() => expect(urls.some((u) => u.get('date_from') === '2026-10-01')).toBe(true))
    const last = urls[urls.length - 1]
    expect(last.get('date_from')).toBe('2026-10-01')
    expect(last.has('date_to')).toBe(false)
  })

  it('test_a_400_range_error_shows_the_servers_message_beside_the_dates', async () => {
    server.use(http.get(`${API}/api/wallet/vendor/sales/`, () => HttpResponse.json({ detail: 'That range is too long. Pick 92 days or fewer.' }, { status: 400 })))
    wrap(<SalesList businessKind="product" />)
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('That range is too long. Pick 92 days or fewer.')
  })

  it('test_load_more_follows_next_and_appends', async () => {
    server.use(http.get(`${API}/api/wallet/vendor/sales/`, ({ request }) => {
      const page = new URL(request.url).searchParams.get('page')
      return page === '2'
        ? envelope([orderRow({ order: 42, reference: 'Order #42' })])
        : envelope([orderRow()], `${API}/api/wallet/vendor/sales/?page=2`)
    }))
    wrap(<SalesList businessKind="product" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Load more' }))
    expect(await screen.findByText('Order #42')).toBeInTheDocument()
    expect(screen.getByText('Order #41')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument())
  })

  it('test_booking_row_shows_the_servers_release_time_in_accra', async () => {
    server.use(http.get(`${API}/api/wallet/vendor/bookings/`, () => envelope([bookingRow()])))
    wrap(<SalesList businessKind="service" />)
    expect(await screen.findByText(/Booking #7/)).toBeInTheDocument()
    expect(screen.getByText(/Service/)).toBeInTheDocument()
    expect(screen.getByText(/Hair braiding/)).toBeInTheDocument()
    expect(screen.getByText('Releases automatically from Fri 16 Oct, 14:05')).toBeInTheDocument()
    expect(screen.getByText('GH₵ 142.50')).toBeInTheDocument()
    expect(screen.getByText('Price')).toBeInTheDocument()
  })

  it('test_on_hold_booking_shows_no_release_time', async () => {
    server.use(http.get(`${API}/api/wallet/vendor/bookings/`, () => envelope([bookingRow({
      on_hold: true, release_at: null, status_label: 'On hold: a problem was reported',
    })])))
    wrap(<SalesList businessKind="service" />)
    expect(await screen.findByText('On hold: a problem was reported')).toBeInTheDocument()
    expect(screen.queryByText(/Releases automatically/)).not.toBeInTheDocument()
  })

  it('test_accepted_service_says_accepted_by_the_customer', async () => {
    server.use(http.get(`${API}/api/wallet/vendor/bookings/`, () => envelope([bookingRow({ customer_accepted: true })])))
    wrap(<SalesList businessKind="service" />)
    expect(await screen.findByText('Accepted by the customer')).toBeInTheDocument()
  })

  it('test_review_focus_no_customer_name_or_phone_renders', async () => {
    server.use(
      http.get(`${API}/api/wallet/vendor/sales/`, () => envelope([orderRow({ customer_name: 'Ama Buyer', customer_phone: '0244000111' })])),
      http.get(`${API}/api/wallet/vendor/bookings/`, () => envelope([bookingRow({ customer_name: 'Ama Buyer', customer_phone: '0244000111' })])),
    )
    wrap(<SalesList businessKind="product" />)
    expect(await screen.findByText('Order #41')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Bookings' }))
    expect(await screen.findByText(/Booking #7/)).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/Ama Buyer|0244000111/)
  })

  it('test_empty_states', async () => {
    wrap(<SalesList businessKind="product" />)
    expect(await screen.findByText('No sales in this range yet.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Bookings' }))
    expect(await screen.findByText('No bookings in this range yet.')).toBeInTheDocument()
  })
})
