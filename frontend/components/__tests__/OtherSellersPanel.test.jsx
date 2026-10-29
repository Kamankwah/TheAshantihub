import { afterEach, describe, expect, test, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '../../mocks/server.js'
import { gatedOpening } from '../../mocks/opening.js'
import OtherSellersPanel from '../shop/OtherSellersPanel.jsx'
import ShortfallPrompt from '../shop/ShortfallPrompt.jsx'

const API = 'http://localhost:8000'
afterEach(() => { localStorage.clear() })

const offer = (o = {}) => ({
  listing_id: 11, name: 'Milo', price_amount: '1300.00', price_now: '1250.00', price_basis: 'regular', price_unit: 'per tin',
  condition: 'new', business_name: 'Kofi Stores', verified: true, zone: 'Adum', available_quantity: 3, ...o,
})
const payload = (offers, featured = 11) => ({
  catalogue_product: { id: 1, brand: 'Milo', name: 'Tin 400g', barcode: '' }, featured_offer_id: featured, ordering: 'price', offers,
})
const serve = (body, spy) => server.use(http.get(`${API}/api/catalogue/listings/:id/other-sellers/`, ({ request }) => {
  spy?.(new URL(request.url).searchParams)
  return HttpResponse.json(body)
}))
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 60)) })
const customer = { accountType: 'customer', id: 1 }

function renderPanel(props = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <OtherSellersPanel listingId={5} user={customer} onAddToCart={vi.fn().mockResolvedValue()} onOpenListing={vi.fn()} {...props} />
    </QueryClientProvider>,
  )
}

describe('OtherSellersPanel', () => {
  test('test_renders_nothing_for_an_ungrouped_listing', async () => {
    const { container } = renderPanel()
    await settle()
    expect(container).toBeEmptyDOMElement()
  })

  test('test_renders_nothing_on_a_404', async () => {
    server.use(http.get(`${API}/api/catalogue/listings/:id/other-sellers/`, () => HttpResponse.json({ detail: 'Not found.' }, { status: 404 })))
    const { container } = renderPanel()
    await settle()
    expect(container).toBeEmptyDOMElement()
  })

  test('test_rows_show_business_name_verified_mark_price_now_and_count', async () => {
    serve(payload([offer(), offer({ listing_id: 12, business_name: null, available_quantity: null, price_now: '1300.00', price_basis: 'discount' })]))
    renderPanel()
    expect(await screen.findByText('Kofi Stores')).toBeInTheDocument()
    expect(screen.getByText('Business name not given')).toBeInTheDocument()
    expect(screen.getByText('GH₵ 1,250.00')).toBeInTheDocument()
    expect(screen.getByText('3 available')).toBeInTheDocument()
    expect(screen.getAllByText(/available$/)).toHaveLength(1)
    expect(screen.getByText('Discounted price')).toBeInTheDocument()
    expect(screen.getByText('Milo Tin 400g')).toBeInTheDocument()
  })

  test('test_featured_label_only_on_the_featured_offer_id', async () => {
    serve(payload([offer(), offer({ listing_id: 12, business_name: 'Ama Shop' })], 12))
    renderPanel()
    await screen.findByText('Ama Shop')
    expect(screen.getAllByText('Best price from a verified business')).toHaveLength(1)
    expect(screen.queryByText('This seller has the best price from a verified business.')).toBeNull()
  })

  test('test_featured_is_this_listing_shows_the_header_line', async () => {
    serve(payload([offer()], 5))
    renderPanel()
    expect(await screen.findByText('This seller has the best price from a verified business.')).toBeInTheDocument()
    expect(screen.queryByText('Best price from a verified business')).toBeNull()
  })

  test('test_featured_and_verified_marks_are_never_gold', async () => {
    serve(payload([offer()]))
    renderPanel()
    const label = await screen.findByText('Best price from a verified business')
    expect(label.outerHTML.toLowerCase()).not.toMatch(/d4a017|gold/)
    const mark = screen.getByRole('img', { name: 'Verified business' })
    expect(mark.outerHTML.toLowerCase()).not.toMatch(/d4a017|gold/)
    expect(screen.getByText('GH₵ 1,250.00').style.fontVariantNumeric).toBe('tabular-nums')
  })

  test('test_verified_mark_only_on_verified_rows_and_no_not_yet_verified_text', async () => {
    serve(payload([offer(), offer({ listing_id: 12, business_name: 'Ama Shop', verified: false })]))
    renderPanel()
    await screen.findByText('Ama Shop')
    expect(screen.getAllByRole('img', { name: 'Verified business' })).toHaveLength(1)
    expect(document.body.textContent).not.toMatch(/Not yet verified/i)
  })

  test('test_rows_carry_no_contact_links_and_no_distance', async () => {
    serve(payload([offer()]))
    const { container } = renderPanel()
    await screen.findByText('Kofi Stores')
    expect(container.querySelectorAll('a[href^="tel:"], a[href^="mailto:"], a[href*="wa.me"]')).toHaveLength(0)
    expect(container.innerHTML).not.toMatch(/wa\.me/)
    expect(container.textContent).not.toMatch(/\bkm\b|metres|away|NaN|undefined|null/i)
  })

  test('test_ordering_pill_asks_for_availability', async () => {
    const seen = []
    serve(payload([offer()]), (p) => seen.push(p.get('ordering')))
    renderPanel()
    await screen.findByText('Kofi Stores')
    fireEvent.click(screen.getByRole('button', { name: 'Most in stock' }))
    await waitFor(() => expect(seen).toContain('availability'))
  })

  test('test_add_posts_the_offer_with_the_chosen_quantity_only_on_click', async () => {
    serve(payload([offer()]))
    const onAddToCart = vi.fn().mockResolvedValue()
    renderPanel({ onAddToCart })
    await screen.findByText('Kofi Stores')
    fireEvent.click(screen.getByRole('button', { name: /^More from/ }))
    expect(onAddToCart).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Add to cart' }))
    await waitFor(() => expect(onAddToCart).toHaveBeenCalledWith({ id: 11 }, 2))
    expect(await screen.findByText('Added to your cart.')).toBeInTheDocument()
  })

  test('test_quantity_stops_at_the_counted_stock', async () => {
    serve(payload([offer({ available_quantity: 2 })]))
    renderPanel()
    await screen.findByText('Kofi Stores')
    const more = screen.getByRole('button', { name: /^More from/ })
    fireEvent.click(more); fireEvent.click(more)
    expect(more).toBeDisabled()
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  test('test_add_disabled_with_the_cart_guard_detail', async () => {
    serve(payload([offer()]))
    server.use(http.get(`${API}/api/cart/guard/`, () => HttpResponse.json({
      shops: [], blocked: false, listing: { id: 11, blocked: { code: 'too_many_shops', detail: 'Your cart already has 4 shops.' } },
    })))
    renderPanel()
    expect(await screen.findByText('Your cart already has 4 shops.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add to cart' })).toBeDisabled()
  })

  test('test_add_disabled_before_opening', async () => {
    server.use(gatedOpening({ opensAt: '2099-11-06T06:00:00Z' }))
    serve(payload([offer()]))
    renderPanel()
    expect(await screen.findByText(/^Opens /)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add to cart' })).toBeDisabled()
  })

  test('test_staff_session_gets_the_staff_notice', async () => {
    serve(payload([offer()]))
    const onAddToCart = vi.fn()
    renderPanel({ user: { accountType: 'staff', id: 2 }, onAddToCart })
    await screen.findByText('Kofi Stores')
    fireEvent.click(screen.getByRole('button', { name: 'Add to cart' }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(onAddToCart).not.toHaveBeenCalled()
  })

  test('test_add_refusal_is_shown_on_the_row', async () => {
    serve(payload([offer()]))
    const err = Object.assign(new Error('x'), { body: { detail: 'Choose a size or colour on the product page.' } })
    renderPanel({ onAddToCart: vi.fn().mockRejectedValue(err) })
    await screen.findByText('Kofi Stores')
    fireEvent.click(screen.getByRole('button', { name: 'Add to cart' }))
    expect(await screen.findByText('Choose a size or colour on the product page.')).toBeInTheDocument()
  })

  test('test_show_all_after_five_rows_and_see_this_offer', async () => {
    const rows = [1, 2, 3, 4, 5, 6].map((i) => offer({ listing_id: 20 + i, business_name: `Shop ${i}` }))
    serve(payload(rows))
    const onOpenListing = vi.fn()
    renderPanel({ onOpenListing })
    await screen.findByText('Shop 1')
    expect(screen.queryByText('Shop 6')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Show all 6' }))
    expect(screen.getByText('Shop 6')).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: 'See this offer' })[0])
    expect(onOpenListing).toHaveBeenCalledWith(21)
  })

  test('test_position_is_sent_only_from_a_saved_default_address', async () => {
    const seen = []
    serve(payload([offer()]), (p) => seen.push([p.get('lat'), p.get('lng')]))
    server.use(http.get(`${API}/api/accounts/addresses/`, () => HttpResponse.json([
      { id: 1, is_default: false, lat: '5.000000', lng: '-1.000000' },
      { id: 2, is_default: true, lat: '6.688400', lng: '-1.624400' },
    ])))
    renderPanel()
    await waitFor(() => expect(seen).toContainEqual(['6.688400', '-1.624400']))
  })

  test('test_no_position_without_coordinates_or_for_a_signed_out_visitor', async () => {
    const seen = []
    serve(payload([offer()]), (p) => seen.push([p.get('lat'), p.get('lng')]))
    server.use(http.get(`${API}/api/accounts/addresses/`, () => HttpResponse.json([{ id: 2, is_default: true, lat: null, lng: null }])))
    renderPanel()
    await screen.findByText('Kofi Stores')
    renderPanel({ user: null })
    await settle()
    expect(seen.every(([a, b]) => a === null && b === null)).toBe(true)
  })
})

describe('ShortfallPrompt', () => {
  const renderPrompt = () => render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <div id="other-sellers" /><ShortfallPrompt listingId={5} />
    </QueryClientProvider>,
  )

  test('test_shortfall_prompt_only_when_other_offers_exist', async () => {
    const { unmount } = renderPrompt()
    await settle()
    expect(screen.queryByText(/other seller/)).toBeNull()
    unmount()
    serve(payload([offer(), offer({ listing_id: 12 })]))
    renderPrompt()
    expect(await screen.findByText(/2 other sellers offer this product\./)).toBeInTheDocument()
  })

  test('test_shortfall_link_scrolls_to_other_sellers', async () => {
    serve(payload([offer()]))
    const scroll = vi.fn()
    window.HTMLElement.prototype.scrollIntoView = scroll
    renderPrompt()
    expect(await screen.findByText(/1 other seller offers this product\./)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'See other sellers' }))
    expect(scroll).toHaveBeenCalled()
  })
})
