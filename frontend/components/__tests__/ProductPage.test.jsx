import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '../../mocks/server.js'
import { installMatchMedia } from '../../test/matchMedia.js'
import ListingDetailPage from '../ListingDetailPage.jsx'
import ReviewHistogram from '../shop/ReviewHistogram.jsx'

const API = 'http://localhost:8000'
const owner = { id: 9, full_name: 'Ama Owusu', name: 'Akosua Ntoma', kyc_status: 'verified', is_ashanti_direct: false }
const CATEGORY = {
  id: 30, slug: 'fabrics', icon: '🧵', label: 'Fabrics', color: '#C8962E', kind: 'product',
  is_accommodation: false, is_food: false, parent: 3, ancestors: [{ id: 3, slug: 'fashion', label: 'Fashion' }],
}
// GET /api/listings/<id>/ as the backend sends it (backend-contract.md A10).
const GOODS = {
  id: 12, name: 'Kente Stole', description: 'Hand-woven in Bonwire.\nSilk and cotton blend.\n\n- Gift box included',
  category: CATEGORY, zone: { id: 2, name: 'Adum' },
  price_amount: '150.00', price_unit: null, tag: null, lat: null, lng: null,
  main_photo: `${API}/media/listings/kente.jpg`,
  photos: [{ id: 5, image: `${API}/media/listings/p1.jpg`, order: 0 }],
  videos: [], created_at: '2026-10-01T10:00:00Z', is_promoted: false,
  specs: [{ label: 'Material', value: 'Silk & cotton' }], service_duration: '',
  avg_rating: 4.5, review_count: 8,
  sale_price: null, sale_ends_at: null, was_price: null, effective_price: '150.00', discount_percent: null,
  variants: [], has_variants: false, variant_axes: [],
  business_owner: owner,
  has_warranty: false, warranty_details: '', has_expiry: false, expiry_date: null, return_policy: '',
  brand: 'Bonwire Weavers', condition: 'new', dimensions: '', weight: '', stock_quantity: 10,
  whats_included: '', requirements: '', revisions: '', delivery_time: '', cancellation_policy: 'flexible',
}
const variant = (id, size, extra = {}) => ({
  id, label: size, attributes: { Size: size }, price_amount: '150.00', sale_price: null, was_price: null, sale_ends_at: null,
  effective_price: '150.00', stock_quantity: 5, position: id, available: true, discount_percent: null, ...extra,
})
const WITH_VARIANTS = {
  ...GOODS, has_variants: true, stock_quantity: null,
  variants: [variant(41, 'Large'), variant(42, 'Small')],
  variant_axes: [{ name: 'Size', values: ['Large', 'Small'] }],
}
const card = (id, name, extra = {}) => ({
  id, name, category: CATEGORY, zone: { id: 2, name: 'Adum' }, price_amount: '90.00', effective_price: '90.00',
  was_price: null, sale_price: null, main_photo: null, photos: [], avg_rating: null, review_count: 0, has_variants: false, ...extra,
})
const CUSTOMER = { id: 1, fullName: 'Kofi', accountType: 'customer' }

class FakeIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  window.IntersectionObserver = FakeIntersectionObserver
  Element.prototype.scrollIntoView = vi.fn()
})
afterEach(() => {
  delete window.IntersectionObserver
  localStorage.clear()
})

function showListing(listing, id = listing.id) {
  server.use(http.get(`${API}/api/listings/${id}/`, () => HttpResponse.json(listing)))
}

function renderPage(props = {}, client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  const ui = render(
    <QueryClientProvider client={client}>
      <ListingDetailPage
        id={12} onBack={vi.fn()} user={null} favourites={[]} onFavourite={vi.fn()} currency="GHS"
        onMessage={vi.fn()} onOpenListing={vi.fn()} onOpenSeller={vi.fn()} onAddToCart={vi.fn().mockResolvedValue(undefined)}
        CardComponent={() => null} {...props}
      />
    </QueryClientProvider>,
  )
  return { ...ui, client }
}

describe('ProductPage', () => {
  test('test_goods_render_the_product_page_and_services_the_service_page', async () => {
    showListing(GOODS)
    const first = renderPage()
    expect(await screen.findByTestId('product-page')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Kente Stole' })).toBeInTheDocument()
    expect(screen.queryByText('Request this service')).toBeNull()
    first.unmount()

    // Food is delivered, so it is goods even though its category kind is "service".
    showListing({ ...GOODS, id: 13, category: { ...CATEGORY, kind: 'service', is_food: true } })
    const food = renderPage({ id: 13 })
    expect(await screen.findByTestId('product-page')).toBeInTheDocument()
    food.unmount()

    showListing({ ...GOODS, id: 14, name: 'City tour', category: { ...CATEGORY, kind: 'service' } })
    const service = renderPage({ id: 14 })
    expect(await screen.findByText('Request this service', { selector: 'button' })).toBeInTheDocument()
    expect(screen.queryByTestId('product-page')).toBeNull()
    service.unmount()

    // A stay is booked, never delivered, whatever its kind says.
    showListing({ ...GOODS, id: 15, name: 'Lodge', category: { ...CATEGORY, is_accommodation: true } })
    renderPage({ id: 15 })
    expect(await screen.findByText('Book your stay')).toBeInTheDocument()
    expect(screen.queryByTestId('product-page')).toBeNull()
  })

  test('test_no_questions_and_answers_anywhere', async () => {
    let qaCalls = 0
    server.use(http.all(`${API}/api/qa/*`, () => { qaCalls += 1; return HttpResponse.json({ count: 0, results: [] }) }))
    showListing(GOODS)
    const goods = renderPage()
    await screen.findByTestId('product-page')
    expect(screen.queryByText(/Q&A/)).toBeNull()
    expect(screen.queryByText(/ask a question/i)).toBeNull()
    goods.unmount()

    showListing({ ...GOODS, id: 14, name: 'City tour', category: { ...CATEGORY, kind: 'service' } })
    renderPage({ id: 14 })
    await screen.findByText('City tour')
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).not.toContain('Q&As')
    expect(screen.queryByText(/Q&A/)).toBeNull()
    await new Promise((r) => setTimeout(r, 80))
    expect(qaCalls).toBe(0)
  })

  test('test_breadcrumb_uses_ancestors_when_present_and_one_crumb_otherwise', async () => {
    showListing(GOODS)
    const first = renderPage()
    await screen.findByTestId('product-page')
    const crumbs = within(screen.getByRole('navigation', { name: 'Breadcrumb' })).getAllByRole('listitem')
    expect(crumbs.map((c) => c.textContent.replace('›', '').trim())).toEqual(['Fashion', 'Fabrics'])
    first.unmount()

    showListing({ ...GOODS, category: { ...CATEGORY, ancestors: [] } })
    const second = renderPage()
    await screen.findByTestId('product-page')
    expect(within(screen.getByRole('navigation', { name: 'Breadcrumb' })).getAllByRole('listitem').map((c) => c.textContent)).toEqual(['Fabrics'])
    second.unmount()

    const { ancestors, ...noAncestors } = CATEGORY
    showListing({ ...GOODS, category: noAncestors })
    renderPage()
    await screen.findByTestId('product-page')
    expect(within(screen.getByRole('navigation', { name: 'Breadcrumb' })).getAllByRole('listitem').map((c) => c.textContent)).toEqual(['Fabrics'])
  })

  test('test_rating_row_is_hidden_when_review_count_is_zero', async () => {
    showListing({ ...GOODS, avg_rating: null, review_count: 0 })
    const first = renderPage()
    await screen.findByTestId('product-page')
    expect(screen.queryByTestId('rating-row')).toBeNull()
    expect(screen.queryByText(/(?<![\d.])0\.0(?!\d)/)).toBeNull()
    first.unmount()

    showListing(GOODS)
    renderPage()
    const row = await screen.findByTestId('rating-row')
    expect(row).toHaveTextContent('4.5')
    expect(row).toHaveTextContent('8 ratings')
  })

  test('test_histogram_renders_percentages_from_the_server_counts', async () => {
    server.use(http.get(`${API}/api/reviews/listing/12/`, () => HttpResponse.json({
      count: 3, next: null, previous: null, avg_rating: 4.333333333333333, review_count: 3,
      distribution: { 5: 2, 4: 1, 3: 0, 2: 0, 1: 0 },
      results: [{ id: 31, target_type: 'listing', rating: 5, comment: 'Great quality.', verified: true, author_name: 'Kofi Boateng', created_at: '2026-10-20T14:02:11Z' }],
    })))
    showListing(GOODS)
    renderPage()
    const histogram = await screen.findByTestId('review-histogram')
    const rows = within(histogram).getAllByRole('listitem').map((li) => li.textContent.replace(/\s+/g, ' ').trim())
    expect(rows).toEqual(['5 star 67%', '4 star 33%', '3 star 0%', '2 star 0%', '1 star 0%'])
    expect(histogram).toHaveTextContent('4.3 out of 5')
    expect(histogram).toHaveTextContent('3 ratings')
    expect(await screen.findByText('Great quality.')).toBeInTheDocument()
    // The write box keeps its eligibility gate, now titled for customers.
    expect(screen.getByText(/Write a customer review/)).toBeInTheDocument()
    expect(screen.getByText('Sign in to leave a review')).toBeInTheDocument()
  })

  test('test_histogram_draws_nothing_without_ratings', () => {
    const { container, rerender } = render(<ReviewHistogram distribution={{ 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 }} total={0} average={null} />)
    expect(container).toBeEmptyDOMElement()
    rerender(<ReviewHistogram distribution={undefined} total={4} average={4} />)
    expect(container).toBeEmptyDOMElement()
  })

  test('test_sticky_strip_has_the_five_sections', async () => {
    server.use(http.get(`${API}/api/listings/12/also-viewed/`, () => HttpResponse.json({ basis: 'co_viewed', results: [card(70, 'Adinkra Scarf')] })))
    showListing(GOODS)
    renderPage()
    await screen.findByTestId('product-page')
    await waitFor(() => expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(
      ['Top', 'About this item', 'Similar', 'Product information', 'Reviews'],
    ))
    // The mini title + price joins the strip once the shopper has moved past the top.
    expect(screen.queryByTestId('sticky-mini')).toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: 'Reviews' }))
    const mini = screen.getByTestId('sticky-mini')
    expect(mini).toHaveTextContent('Kente Stole')
    expect(mini).toHaveTextContent('GHS 150.00')
    expect(await screen.findByRole('heading', { name: 'Customers also viewed' })).toBeInTheDocument()
  })

  test('test_empty_about_and_empty_info_groups_are_not_rendered', async () => {
    showListing({ ...GOODS, description: '  \n ', specs: [] })
    const first = renderPage()
    await screen.findByTestId('product-page')
    expect(screen.queryByRole('heading', { name: 'About this item' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Product information' })).toBeNull()
    expect(screen.queryByText('Item details')).toBeNull()
    expect(screen.queryByText('Warranty & returns')).toBeNull()
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Top', 'Reviews'])
    first.unmount()

    // Only the group with data shows: a return policy but no specs.
    showListing({ ...GOODS, specs: [], return_policy: 'Returns within 7 days if unused.' })
    renderPage()
    await screen.findByTestId('product-page')
    expect(screen.getByRole('heading', { name: 'Product information' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Warranty & returns' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.queryByRole('button', { name: 'Item details' })).toBeNull()
  })

  test('test_product_information_groups_collapse_and_show_the_listing_fields', async () => {
    showListing({ ...GOODS, has_warranty: true, warranty_details: '12-month cover', return_policy: 'Returns within 7 days.' })
    renderPage()
    await screen.findByTestId('product-page')
    const info = document.getElementById('pdp-info')
    expect(within(info).getByText('Material')).toBeInTheDocument()
    expect(within(info).getByText('Silk & cotton')).toBeInTheDocument()
    expect(within(info).getByText('12-month cover')).toBeInTheDocument()
    expect(within(info).getByText('Returns within 7 days.')).toBeInTheDocument()
    fireEvent.click(within(info).getByRole('button', { name: 'Item details' }))
    expect(within(info).getByRole('button', { name: 'Item details' })).toHaveAttribute('aria-expanded', 'false')
    expect(within(info).queryByText('Silk & cotton')).toBeNull()
  })

  test('test_key_facts_and_about_this_item_bullets', async () => {
    showListing(GOODS)
    renderPage()
    await screen.findByTestId('product-page')
    const facts = screen.getByTestId('key-facts')
    expect(within(facts).getByText('Brand')).toBeInTheDocument()
    expect(within(facts).getByText('Bonwire Weavers')).toBeInTheDocument()
    expect(within(facts).getByText('New')).toBeInTheDocument()
    const about = document.getElementById('pdp-about')
    expect(within(about).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Hand-woven in Bonwire.', 'Silk and cotton blend.', 'Gift box included',
    ])
  })

  test('test_other_sellers_anchor_exists_and_is_empty', async () => {
    showListing(GOODS)
    const { container } = renderPage()
    await screen.findByTestId('product-page')
    const section = container.querySelector('section#other-sellers')
    expect(section).not.toBeNull()
    expect(section).toBeEmptyDOMElement()
  })

  test('test_records_a_view_once_after_three_seconds', async () => {
    const posts = []
    server.use(http.post(`${API}/api/listings/12/view/`, async ({ request }) => {
      posts.push(await request.json())
      return new HttpResponse(null, { status: 204 })
    }))
    showListing(GOODS)
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      renderPage()
      await screen.findByTestId('product-page')
      await act(async () => { vi.advanceTimersByTime(2500) })
      expect(posts).toHaveLength(0)
      await act(async () => { vi.advanceTimersByTime(600) })
      await waitFor(() => expect(posts).toHaveLength(1))
      await act(async () => { vi.advanceTimersByTime(10000) })
      expect(posts).toHaveLength(1)
      // A signed-out visitor is counted by an anonymous id kept in this browser.
      expect(posts[0].viewer).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    } finally {
      vi.useRealTimers()
    }
  })

  test('test_a_sold_out_listing_still_renders_but_cannot_be_added', async () => {
    let posted = 0
    server.use(
      http.post(`${API}/api/cart/items/`, () => { posted += 1; return HttpResponse.json({}, { status: 201 }) }),
      http.post(`${API}/api/cart/items/bulk/`, () => { posted += 1; return HttpResponse.json({}, { status: 201 }) }),
    )
    showListing({ ...GOODS, stock_quantity: 0 })
    const first = renderPage({ user: CUSTOMER })
    expect(await screen.findByRole('heading', { level: 1, name: 'Kente Stole' })).toBeInTheDocument()
    const btn = screen.getByRole('button', { name: 'Out of stock' })
    expect(btn).toBeDisabled()
    fireEvent.click(btn)
    first.unmount()

    showListing({ ...WITH_VARIANTS, variants: WITH_VARIANTS.variants.map((v) => ({ ...v, stock_quantity: 0, available: false })) })
    renderPage({ user: CUSTOMER })
    await screen.findByTestId('product-page')
    expect(screen.getByRole('button', { name: 'Out of stock' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Large' })).toHaveAttribute('aria-disabled', 'true')
    await new Promise((r) => setTimeout(r, 50))
    expect(posted).toBe(0)
  })

  test('test_phone_layout_puts_gallery_then_buy_box_then_details', async () => {
    const order = () => {
      const g = screen.getByTestId('product-gallery')
      const b = screen.getByTestId('buy-box')
      const d = screen.getByTestId('product-details')
      return {
        galleryBeforeBuy: Boolean(g.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING),
        buyBeforeDetails: Boolean(b.compareDocumentPosition(d) & Node.DOCUMENT_POSITION_FOLLOWING),
      }
    }
    const media = installMatchMedia(375)
    try {
      server.use(http.get(`${API}/api/storefront/sponsored/`, () => HttpResponse.json([card(80, 'Batakari Smock')])))
      showListing(GOODS)
      const phone = renderPage()
      await screen.findByTestId('product-page')
      expect(order()).toEqual({ galleryBeforeBuy: true, buyBeforeDetails: true })
      // No full-width sponsored card ahead of the product's details on a phone: it joins the Sponsored carousel.
      const carousel = (await screen.findByRole('heading', { name: 'Sponsored products' })).closest('section')
      expect(within(carousel).getByText('Batakari Smock')).toBeInTheDocument()
      expect(screen.queryByTestId('sponsored-card')).toBeNull()
      phone.unmount()
    } finally {
      media.restore()
    }
    // Desktop: gallery | details | buy box.
    showListing(GOODS)
    renderPage()
    await screen.findByTestId('product-page')
    expect(order()).toEqual({ galleryBeforeBuy: true, buyBeforeDetails: false })
  })

  test('test_more_from_ashanti_direct_goes_through_onShowDirect', async () => {
    showListing({ ...GOODS, business_owner: { ...owner, name: 'Ashanti Direct', is_ashanti_direct: true } })
    const onShowDirect = vi.fn()
    renderPage({ onShowDirect })
    fireEvent.click(await screen.findByRole('button', { name: 'More from Ashanti Direct' }))
    expect(onShowDirect).toHaveBeenCalledTimes(1)
  })

  test('test_selection_drops_vanished_variants_and_clamps_to_stock_after_a_refetch', async () => {
    const posts = []
    server.use(http.post(`${API}/api/cart/items/bulk/`, async ({ request }) => {
      posts.push(await request.json())
      return HttpResponse.json({ id: 1, items: [], total: '0.00' }, { status: 201 })
    }))
    showListing(WITH_VARIANTS)
    const { client } = renderPage({ user: CUSTOMER })
    await screen.findByTestId('product-page')
    fireEvent.click(screen.getByRole('button', { name: 'Large' }))
    for (let i = 0; i < 3; i++) fireEvent.click(screen.getByRole('button', { name: 'Increase quantity of Large' }))
    fireEvent.click(screen.getByRole('button', { name: 'Small' }))
    expect(screen.getAllByTestId('selection-row')).toHaveLength(2)

    // The listing changes under the shopper: Large now has 2 left and Small is gone.
    showListing({ ...WITH_VARIANTS, variants: [variant(41, 'Large', { stock_quantity: 2 })], variant_axes: [{ name: 'Size', values: ['Large'] }] })
    await act(async () => { await client.invalidateQueries({ queryKey: ['listing', 12] }) })
    await waitFor(() => expect(screen.getAllByTestId('selection-row')).toHaveLength(1))
    expect(screen.getByTestId('qty-value')).toHaveTextContent('2')
    fireEvent.click(screen.getByRole('button', { name: 'Add to cart' }))
    await waitFor(() => expect(posts).toHaveLength(1))
    expect(posts[0]).toEqual({ listing: 12, lines: [{ variant: 41, quantity: 2 }] })
  })

  test('test_selection_clears_after_a_successful_add', async () => {
    showListing(WITH_VARIANTS)
    renderPage({ user: CUSTOMER })
    await screen.findByTestId('product-page')
    fireEvent.click(screen.getByRole('button', { name: 'Small' }))
    expect(screen.getAllByTestId('selection-row')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Add to cart' }))
    expect(await screen.findByText('Added to cart ✓')).toBeInTheDocument()
    expect(screen.queryAllByTestId('selection-row')).toHaveLength(0)
    // The picker starts again too: no option left pressed.
    expect(screen.getByRole('button', { name: 'Small' })).toHaveAttribute('aria-pressed', 'false')
  })

  test('test_a_signed_out_add_goes_to_the_app_sign_in_and_posts_nothing', async () => {
    let posted = 0
    server.use(http.post(`${API}/api/cart/items/`, () => { posted += 1; return HttpResponse.json({}, { status: 201 }) }))
    const onAddToCart = vi.fn().mockRejectedValue(new Error('Please sign in as a customer to add items to your cart.'))
    showListing(GOODS)
    renderPage({ onAddToCart })
    fireEvent.click(await screen.findByRole('button', { name: 'Add to cart' }))
    expect(await screen.findByText('Please sign in as a customer to add items to your cart.')).toBeInTheDocument()
    expect(onAddToCart).toHaveBeenCalledWith(expect.objectContaining({ id: 12 }), 1)
    await new Promise((r) => setTimeout(r, 50))
    expect(posted).toBe(0)
  })

  test('test_add_to_list_saves_to_the_wishlist', async () => {
    const posts = []
    server.use(http.post(`${API}/api/wishlist/`, async ({ request }) => {
      posts.push(await request.json())
      return HttpResponse.json({ id: 15, listing: card(12, 'Kente Stole'), added_at: '2026-10-28T09:20:00Z' }, { status: 201 })
    }))
    showListing(GOODS)
    const guest = renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Add to list' }))
    expect(await screen.findByText('Sign in to save this to Your Lists.')).toBeInTheDocument()
    expect(posts).toHaveLength(0)
    guest.unmount()

    renderPage({ user: CUSTOMER })
    fireEvent.click(await screen.findByRole('button', { name: 'Add to list' }))
    expect(await screen.findByText('Saved to Your Lists.')).toBeInTheDocument()
    expect(posts).toEqual([{ listing: 12 }])
  })

  test('test_a_business_account_sees_why_it_cannot_buy', async () => {
    let listPosts = 0
    server.use(http.post(`${API}/api/wishlist/`, () => { listPosts += 1; return HttpResponse.json({}, { status: 201 }) }))
    showListing(GOODS)
    renderPage({ user: { id: 5, fullName: 'Biz Owner', accountType: 'business_owner' } })
    expect(await screen.findByText(/Business accounts can't purchase/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Customer accounts only' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Add to list' }))
    expect(screen.getByText(/Lists are for customer accounts/)).toBeInTheDocument()
    expect(listPosts).toBe(0)
  })

  test('test_sponsored_card_and_carousel_come_from_the_public_feed', async () => {
    let query = null
    server.use(http.get(`${API}/api/storefront/sponsored/`, ({ request }) => {
      query = Object.fromEntries(new URL(request.url).searchParams)
      return HttpResponse.json([card(80, 'Batakari Smock'), card(81, 'Leather Sandals'), card(82, 'Beaded Bracelet')])
    }))
    const onOpenListing = vi.fn()
    showListing(GOODS)
    renderPage({ onOpenListing })
    const side = await screen.findByTestId('sponsored-card')
    expect(side).toHaveTextContent('Sponsored')
    expect(side).toHaveTextContent('Batakari Smock')
    expect(query).toEqual({ category: '30', exclude: '12', limit: '12' })
    const carousel = (await screen.findByRole('heading', { name: 'Sponsored products' })).closest('section')
    expect(within(carousel).getByText('Leather Sandals')).toBeInTheDocument()
    expect(within(carousel).queryByText('Batakari Smock')).toBeNull()
    fireEvent.click(within(side).getByRole('button', { name: /Batakari Smock/ }))
    expect(onOpenListing).toHaveBeenCalledWith(80)
  })

  test('test_the_page_follows_the_theme_instead_of_a_fixed_dark_ground', async () => {
    server.use(http.get(`${API}/api/reviews/listing/12/`, () => HttpResponse.json({
      count: 1, next: null, previous: null, avg_rating: 5, review_count: 1, distribution: { 5: 1, 4: 0, 3: 0, 2: 0, 1: 0 },
      results: [{ id: 31, target_type: 'listing', rating: 5, comment: 'Great quality.', verified: true, author_name: 'Kofi Boateng', created_at: '2026-10-20T14:02:11Z' }],
    })))
    showListing(GOODS)
    renderPage()
    const page = await screen.findByTestId('product-page')
    await screen.findByText('Great quality.')
    fireEvent.click(screen.getByRole('button', { name: /Sold by Akosua Ntoma/ }))
    const fixedDark = [...page.querySelectorAll('[style]')].filter((el) => {
      const s = el.getAttribute('style')
      return /color:\s*(white|#fff\b|#ffffff|rgba?\(255,\s*255,\s*255)/i.test(s) || /#160E08|rgb\(22,\s*14,\s*8\)/i.test(s)
    })
    expect(fixedDark.map((el) => el.outerHTML.slice(0, 120))).toEqual([])
  })
})
