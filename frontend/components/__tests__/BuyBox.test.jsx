import { useState } from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '../../mocks/server.js'
import { gatedOpening } from '../../mocks/opening.js'
import BuyBox from '../shop/BuyBox.jsx'

afterEach(() => { localStorage.clear() })

const owner = { id: 9, full_name: 'Ama Owusu', name: 'Akosua Ntoma', kyc_status: 'verified', is_ashanti_direct: false }
const variant = (id, label, extra = {}) => ({
  id, label, attributes: {}, price_amount: '150.00', effective_price: '120.00', was_price: null,
  discount_percent: null, stock_quantity: 5, available: true, ...extra,
})
const plain = (extra = {}) => ({
  id: 12, name: 'Kente Stole', price_amount: '150.00', effective_price: '150.00', was_price: null, discount_percent: null,
  has_variants: false, variants: [], variant_axes: [], stock_quantity: 10, business_owner: owner,
  has_warranty: false, warranty_details: '', return_policy: '', ...extra,
})
const withVariants = (extra = {}) => plain({
  has_variants: true, price_amount: '150.00', effective_price: '120.00',
  variants: [variant(41, 'Gold / Large'), variant(42, 'Gold / Small', { effective_price: '100.00' })], ...extra,
})
const customer = { accountType: 'customer', id: 1 }

function renderBox(props = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const spy = vi.spyOn(client, 'invalidateQueries')
  const ui = render(
    <QueryClientProvider client={client}>
      <BuyBox item={plain()} user={customer} selection={{}} onMessage={() => {}} onSaveToList={() => {}} {...props} />
    </QueryClientProvider>,
  )
  return { ...ui, spy }
}
const addBtn = () => screen.getByRole('button', { name: /add to cart|opens|out of stock|no price|choose options/i })

describe('BuyBox', () => {
  test('test_price_has_no_was_price_when_the_server_sends_none', () => {
    renderBox()
    expect(screen.getByText('GHS 150.00')).toBeInTheDocument()
    expect(screen.queryByText(/^Was /)).toBeNull()
    expect(screen.queryByText(/^-\d+%$/)).toBeNull()
  })

  test('test_was_price_and_percent_render_when_sent', () => {
    renderBox({ item: plain({ effective_price: '120.00', was_price: '150.00', discount_percent: 20 }) })
    expect(screen.getByText('GHS 120.00')).toBeInTheDocument()
    expect(screen.getByText('Was GHS 150.00')).toBeInTheDocument()
    expect(screen.getByText('-20%')).toBeInTheDocument()
  })

  test('test_no_delivery_date_is_shown', () => {
    renderBox()
    expect(screen.getByText(/Delivery fee is worked out at checkout from your GhanaPost address/)).toBeInTheDocument()
    expect(screen.queryByText(/arrives|delivered by|get it by|estimated delivery/i)).toBeNull()
    expect(screen.getByText('Pay with mobile money or your AshantiHub wallet')).toBeInTheDocument()
  })

  test('test_add_is_disabled_with_opens_6_nov_before_opening', async () => {
    server.use(gatedOpening({ opensAt: '2026-11-06T06:00:00Z', serverNow: '2026-10-29T10:00:00Z' }))
    renderBox()
    const btn = await screen.findByRole('button', { name: 'Opens 6 Nov' })
    expect(btn).toBeDisabled()
  })

  test('test_add_is_disabled_at_zero_stock_with_out_of_stock', () => {
    renderBox({ item: plain({ stock_quantity: 0 }) })
    expect(screen.getAllByText('Out of stock').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'Out of stock' })).toBeDisabled()
  })

  test('test_variants_ask_to_choose_options_until_something_is_selected', () => {
    renderBox({ item: withVariants() })
    expect(screen.getAllByText('Choose options').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'Choose options' })).toBeDisabled()
  })

  test('test_subtotal_sums_every_selected_variant', () => {
    renderBox({ item: withVariants(), selection: { 41: 2, 42: 1 } })
    expect(screen.getByTestId('buybox-subtotal')).toHaveTextContent('GHS 340.00')
  })

  test('test_add_posts_one_bulk_request_with_every_selected_variant', async () => {
    const posts = []
    server.use(http.post('http://localhost:8000/api/cart/items/bulk/', async ({ request }) => {
      posts.push(await request.json())
      return HttpResponse.json({ id: 1, items: [], total: '340.00' }, { status: 201 })
    }))
    const { spy } = renderBox({ item: withVariants(), selection: { 41: 2, 42: 1 } })
    fireEvent.click(screen.getByRole('button', { name: 'Add to cart' }))
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: ['cart'] }))
    expect(spy).toHaveBeenCalledWith({ queryKey: ['cart-guard'] })
    expect(posts).toEqual([{ listing: 12, lines: [{ variant: 41, quantity: 2 }, { variant: 42, quantity: 1 }] }])
  })

  test('test_plain_listing_posts_the_single_item_endpoint', async () => {
    const posts = []
    server.use(http.post('http://localhost:8000/api/cart/items/', async ({ request }) => {
      posts.push(await request.json())
      return HttpResponse.json({ id: 1 }, { status: 201 })
    }))
    renderBox()
    fireEvent.click(screen.getByRole('button', { name: 'Add to cart' }))
    await waitFor(() => expect(posts).toHaveLength(1))
    expect(posts[0]).toEqual({ listing: 12, quantity: 1 })
  })

  test('test_server_line_error_is_shown_and_cart_not_refetched_as_changed', async () => {
    server.use(http.post('http://localhost:8000/api/cart/items/bulk/', () =>
      HttpResponse.json({ lines: [{ index: 0, detail: 'Gold / Large: only 3 in stock.' }] }, { status: 400 })))
    const { spy } = renderBox({ item: withVariants(), selection: { 41: 4 } })
    fireEvent.click(screen.getByRole('button', { name: 'Add to cart' }))
    expect(await screen.findByText('Gold / Large: only 3 in stock.')).toBeInTheDocument()
    expect(spy).not.toHaveBeenCalled()
  })

  test('test_a_second_click_while_busy_does_not_post_again', async () => {
    let count = 0
    let release
    const gate = new Promise((r) => { release = r })
    server.use(http.post('http://localhost:8000/api/cart/items/bulk/', async () => {
      count += 1
      await gate
      return HttpResponse.json({ id: 1, items: [], total: '0.00' }, { status: 201 })
    }))
    renderBox({ item: withVariants(), selection: { 41: 1 } })
    const btn = screen.getByRole('button', { name: 'Add to cart' })
    fireEvent.click(btn)
    fireEvent.click(btn)
    fireEvent.click(btn)
    release()
    await screen.findByRole('button', { name: /added/i })
    expect(count).toBe(1)
  })

  test('test_the_added_confirmation_outlasts_a_selection_the_page_clears', async () => {
    function Page() {
      const [selection, setSelection] = useState({ 41: 1 })
      return <BuyBox item={withVariants()} user={customer} selection={selection} onAdded={() => setSelection({})} />
    }
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={client}><Page /></QueryClientProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Add to cart' }))
    expect(await screen.findByRole('button', { name: 'Added to cart ✓' })).toBeInTheDocument()
    expect(screen.queryByTestId('buybox-subtotal')).toBeNull()
  })

  test('test_staff_session_sees_the_staff_notice_instead_of_adding', async () => {
    let posted = false
    server.use(http.post('http://localhost:8000/api/cart/items/', () => { posted = true; return HttpResponse.json({}, { status: 201 }) }))
    renderBox({ user: { accountType: 'staff' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add to cart' }))
    expect(await screen.findByText("Staff accounts can't shop or sell. Sign out first.")).toBeInTheDocument()
    expect(posted).toBe(false)
  })

  test('test_a_business_account_cannot_add_and_is_told_why', async () => {
    let posted = false
    server.use(http.post('http://localhost:8000/api/cart/items/', () => { posted = true; return HttpResponse.json({}, { status: 201 }) }))
    renderBox({ user: { id: 5, accountType: 'business_owner' } })
    const btn = screen.getByRole('button', { name: 'Customer accounts only' })
    expect(btn).toBeDisabled()
    fireEvent.click(btn)
    await new Promise((r) => setTimeout(r, 30))
    expect(posted).toBe(false)
  })

  test('test_cart_guard_block_message_disables_add', async () => {
    server.use(http.get('http://localhost:8000/api/cart/guard/', () => HttpResponse.json({
      active: true, listing: { id: 12, blocked: { detail: 'Your delivery can include up to 4 shops. Remove one to add this.', code: 'shop_limit' } },
    })))
    renderBox()
    expect(await screen.findByText('Your delivery can include up to 4 shops. Remove one to add this.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add to cart' })).toBeDisabled()
  })

  test('test_sold_by_shows_display_name_and_ashanti_direct_badge', () => {
    const onShowDirect = vi.fn()
    renderBox({ item: plain({ business_owner: { ...owner, is_ashanti_direct: true } }), onShowDirect })
    expect(screen.getByText('Akosua Ntoma')).toBeInTheDocument()
    expect(screen.getByText('Ashanti Direct')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'More from Ashanti Direct' }))
    expect(onShowDirect).toHaveBeenCalledTimes(1)
  })

  test('test_no_ashanti_direct_badge_for_other_sellers', () => {
    renderBox()
    expect(screen.queryByText('Ashanti Direct')).toBeNull()
    expect(screen.queryByRole('button', { name: 'More from Ashanti Direct' })).toBeNull()
  })

  test('test_verified_mark_follows_identity_verified_only', () => {
    const { unmount } = renderBox({ item: plain({ business_owner: { ...owner, identity_verified: true } }) })
    expect(screen.getByLabelText('Verified business')).toBeInTheDocument()
    unmount()
    // kyc_status 'verified' (address checked) without an approved identity shows no mark and no "unverified" label.
    renderBox({ item: plain({ business_owner: { ...owner, kyc_status: 'verified', identity_verified: false } }) })
    expect(screen.queryByLabelText('Verified business')).toBeNull()
    expect(screen.queryByText(/unverified|not verified/i)).toBeNull()
  })

  test('test_there_is_no_business_phone_or_whatsapp_link', () => {
    const { container } = renderBox({ item: plain({ business_owner: { ...owner, is_ashanti_direct: true } }) })
    expect(container.querySelector('a[href^="tel:"]')).toBeNull()
    expect(container.querySelector('a[href*="wa.me"]')).toBeNull()
    expect(container.querySelector('a[href*="whatsapp"]')).toBeNull()
  })

  test('test_report_issue_calls_onMessage', () => {
    const onMessage = vi.fn()
    const item = plain()
    renderBox({ item, onMessage })
    fireEvent.click(screen.getByRole('button', { name: 'Report an issue with this item' }))
    fireEvent.click(screen.getByRole('button', { name: 'Contact Support' }))
    expect(onMessage).toHaveBeenCalledTimes(2)
    expect(onMessage).toHaveBeenCalledWith(item)
  })

  test('test_add_to_list_calls_onSaveToList', () => {
    const onSaveToList = vi.fn()
    renderBox({ onSaveToList })
    fireEvent.click(screen.getByRole('button', { name: 'Add to list' }))
    expect(onSaveToList).toHaveBeenCalledTimes(1)
  })

  test('test_returns_and_warranty_rows_come_only_from_non_blank_listing_fields', () => {
    const { unmount } = renderBox()
    expect(screen.queryByText(/^Returns/)).toBeNull()
    expect(screen.queryByText(/^Warranty/)).toBeNull()
    unmount()
    renderBox({ item: plain({ has_warranty: true, warranty_details: '12 months', return_policy: '7 days, unused' }) })
    expect(screen.getByText('12 months')).toBeInTheDocument()
    expect(screen.getByText('7 days, unused')).toBeInTheDocument()
  })

  test('test_reserves_the_other_sellers_section', () => {
    const { container } = renderBox()
    const section = container.querySelector('section#other-sellers')
    expect(section).not.toBeNull()
    expect(section).toBeEmptyDOMElement()
  })
})
