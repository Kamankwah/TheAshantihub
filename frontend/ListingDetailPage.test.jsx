import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { server } from './mocks/server.js'
import { gatedOpening } from './mocks/opening.js'
import { setStoredAuth } from './apiClient.js'
import ListingDetailPage from './components/ListingDetailPage.jsx'

const LISTING = {
  id: 1,
  name: 'Royal Ashanti Lodge',
  description: 'Luxury rooms with kente-draped interiors.',
  category: { slug: 'hotels', icon: '🏨', label: 'Hotels', color: '#000080', kind: 'product' },
  zone: { name: 'Manhyia' },
  price_amount: '450.00',
  price_unit: '/night',
  tag: 'Featured',
  lat: '6.688500',
  lng: '-1.624400',
  main_photo: 'http://localhost:8000/media/listing_photos/main/lodge.jpg',
  photos: [
    { id: 1, image: 'http://localhost:8000/media/listing_photos/gallery/1.jpg', order: 0 },
    { id: 2, image: 'http://localhost:8000/media/listing_photos/gallery/2.jpg', order: 1 },
  ],
  created_at: '2026-07-09T00:00:00Z',
  // Present on every real public listing since Phase 5's promote/boost
  // feature (docs/BUSINESS_EVENTS_ROADMAP.md).
  is_promoted: false,
  // Reviews/ratings/Q&A/tabbed-PDP work — real fields on GET
  // /api/listings/{id}/ as of that plan's Phase 2.
  specs: [{ label: 'Bed size', value: 'King' }],
  service_duration: '',
  avg_rating: 4.5,
  review_count: 2,
  business_owner: { id: 9, full_name: 'Ama Boateng', kyc_status: 'verified' },
}

const SERVICE_LISTING = {
  ...LISTING,
  id: 2,
  name: 'Kumasi City Tour',
  category: { slug: 'tours', icon: '🚌', label: 'Tours', color: '#CC0000', kind: 'service' },
  specs: [],
  service_duration: '3 hours',
}

function StubCard({ item, onOpen }) {
  return <div onClick={() => onOpen && onOpen(item.id)}>{item.name}</div>
}

function renderPage(props = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <ListingDetailPage
        id={1}
        onBack={vi.fn()}
        user={null}
        favourites={[]}
        onFavourite={vi.fn()}
        currency="GHS"
        onMessage={vi.fn()}
        onAddToCart={vi.fn().mockResolvedValue(undefined)}
        CardComponent={StubCard}
        {...props}
      />
    </QueryClientProvider>,
  )
}

describe('ListingDetailPage', () => {
  it('renders the listing name, description and price once loaded', async () => {
    server.use(http.get('http://localhost:8000/api/listings/1/', () => HttpResponse.json(LISTING)))
    renderPage()
    expect(await screen.findByText('Royal Ashanti Lodge')).toBeInTheDocument()
    expect(screen.getByText(/Luxury rooms with kente-draped interiors/)).toBeInTheDocument()
    expect(within(screen.getByTestId('buy-box')).getByText('GHS 450.00')).toBeInTheDocument()
  })

  it('shows no business phone or tel link even if a response still carried one', async () => {
    server.use(http.get('http://localhost:8000/api/listings/1/', () => HttpResponse.json({ ...LISTING, contact_phone: '+233244000001' })))
    const { container } = renderPage()
    expect(await screen.findByText('Royal Ashanti Lodge')).toBeInTheDocument()
    expect(container.querySelector('a[href^="tel:"]')).toBeNull()
    expect(container.querySelector('a[href*="wa.me"]')).toBeNull()
    expect(container.textContent).not.toMatch(/233244000001|0244000001/)
  })

  it('renders a gallery thumbnail per photo, the main photo first', async () => {
    server.use(http.get('http://localhost:8000/api/listings/1/', () => HttpResponse.json(LISTING)))
    renderPage()
    await screen.findByText('Royal Ashanti Lodge')
    expect(screen.getAllByTestId('gallery-thumb')).toHaveLength(3)
    expect(screen.getByLabelText('Show photo 1')).toBeInTheDocument()
    expect(screen.getByLabelText('Show photo 3')).toBeInTheDocument()
  })

  it('renders an enabled Add to cart button for a priced listing', async () => {
    server.use(http.get('http://localhost:8000/api/listings/1/', () => HttpResponse.json(LISTING)))
    renderPage()
    await screen.findByText('Royal Ashanti Lodge')
    expect(screen.getByRole('button', { name: 'Add to cart' })).not.toBeDisabled()
  })

  it('blocks a business account from buying, showing a notice instead of Add to cart', async () => {
    server.use(http.get('http://localhost:8000/api/listings/1/', () => HttpResponse.json(LISTING)))
    renderPage({ user: { id: 5, fullName: 'Biz Owner', accountType: 'business_owner' } })
    await screen.findByText('Royal Ashanti Lodge')
    expect(screen.getByText(/Business accounts can't purchase/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add to cart' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Customer accounts only' })).toBeDisabled()
  })

  it('disables Add to cart when the listing has no price', async () => {
    server.use(http.get('http://localhost:8000/api/listings/1/', () => HttpResponse.json({ ...LISTING, price_amount: null })))
    renderPage()
    await screen.findByText('Royal Ashanti Lodge')
    expect(screen.getByRole('button', { name: 'No price set' })).toBeDisabled()
  })

  it('a customer adds through the buy box and sees an "Added" confirmation', async () => {
    const posts = []
    server.use(
      http.get('http://localhost:8000/api/listings/1/', () => HttpResponse.json(LISTING)),
      http.post('http://localhost:8000/api/cart/items/', async ({ request }) => {
        posts.push(await request.json())
        return HttpResponse.json({ id: 1 }, { status: 201 })
      }),
    )
    const onAddToCart = vi.fn().mockResolvedValue(undefined)
    renderPage({ user: { id: 4, fullName: 'Ama Boateng', accountType: 'customer' }, onAddToCart })
    await screen.findByText('Royal Ashanti Lodge')
    fireEvent.click(screen.getByRole('button', { name: 'Add to cart' }))
    expect(await screen.findByText('Added to cart ✓')).toBeInTheDocument()
    expect(posts).toEqual([{ listing: 1, quantity: 1 }])
    expect(onAddToCart).not.toHaveBeenCalled()
  })

  it('shows an error message next to the button when onAddToCart rejects', async () => {
    server.use(http.get('http://localhost:8000/api/listings/1/', () => HttpResponse.json(LISTING)))
    const onAddToCart = vi.fn().mockRejectedValue(new Error('Only customer accounts can add items to a cart.'))
    renderPage({ onAddToCart })
    await screen.findByText('Royal Ashanti Lodge')
    fireEvent.click(screen.getByRole('button', { name: 'Add to cart' }))
    expect(await screen.findByText('Only customer accounts can add items to a cart.')).toBeInTheDocument()
  })

  it('calls onBack when the back button is clicked', async () => {
    server.use(http.get('http://localhost:8000/api/listings/1/', () => HttpResponse.json(LISTING)))
    const onBack = vi.fn()
    renderPage({ onBack })
    await screen.findByText('Royal Ashanti Lodge')
    fireEvent.click(screen.getByText('‹ Back to results'))
    expect(onBack).toHaveBeenCalled()
  })

  // The Related rail is the service/stay page's; goods show the also-viewed carousel instead.
  it('renders related listings from useRelatedListings via the injected CardComponent', async () => {
    server.use(
      http.get('http://localhost:8000/api/listings/2/', () => HttpResponse.json(SERVICE_LISTING)),
      http.get('http://localhost:8000/api/listings/2/related/', () =>
        HttpResponse.json([{ id: 5, name: 'Adum Guest House', category: LISTING.category }]),
      ),
    )
    renderPage({ id: 2 })
    await waitFor(() => expect(screen.getByTestId('related-rail')).toBeInTheDocument())
    expect(within(screen.getByTestId('related-rail')).getByText('Adum Guest House')).toBeInTheDocument()
  })

  it('forwards onOpenListing as onOpen to related CardComponent instances', async () => {
    server.use(
      http.get('http://localhost:8000/api/listings/2/', () => HttpResponse.json(SERVICE_LISTING)),
      http.get('http://localhost:8000/api/listings/2/related/', () =>
        HttpResponse.json([{ id: 5, name: 'Adum Guest House', category: LISTING.category }]),
      ),
    )
    const onOpenListing = vi.fn()
    renderPage({ id: 2, onOpenListing })
    await waitFor(() => expect(screen.getByTestId('related-rail')).toBeInTheDocument())
    fireEvent.click(within(screen.getByTestId('related-rail')).getByText('Adum Guest House'))
    expect(onOpenListing).toHaveBeenCalledWith(5)
  })

  it('shows a retry option on error', async () => {
    server.use(http.get('http://localhost:8000/api/listings/1/', () => new HttpResponse(null, { status: 500 })))
    renderPage()
    expect(await screen.findByText('Could not load this listing.')).toBeInTheDocument()
  })
})

describe('ListingDetailPage — tabbed sections (reviews/ratings/Q&A Phase 5)', () => {
  it('renders the product tab set, in order, for a product listing', async () => {
    server.use(
      http.get('http://localhost:8000/api/listings/1/', () => HttpResponse.json(LISTING)),
      http.get('http://localhost:8000/api/listings/1/also-viewed/', () => HttpResponse.json({
        basis: 'same_category', results: [{ id: 2, name: 'Adum Guest House', category: LISTING.category, price_amount: '300.00', review_count: 0 }],
      })),
    )
    renderPage()
    await screen.findByText('Royal Ashanti Lodge')
    await waitFor(() => expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual([
      'Top', 'About this item', 'Similar', 'Product information', 'Reviews',
    ]))
  })

  it('renders the service tab set, in order, for a service listing', async () => {
    server.use(http.get('http://localhost:8000/api/listings/2/', () => HttpResponse.json(SERVICE_LISTING)))
    renderPage({ id: 2 })
    await screen.findByText('Kumasi City Tour')
    const tabLabels = screen.getAllByRole('tab').map((t) => t.textContent)
    expect(tabLabels).toEqual([
      'Overview', 'Service Duration', 'Reviews', 'Compare Services', 'Service satisfaction & dispute', 'More Service options',
    ])
  })

  it('renders the specs table for a product listing', async () => {
    server.use(http.get('http://localhost:8000/api/listings/1/', () => HttpResponse.json(LISTING)))
    renderPage()
    await screen.findByText('Royal Ashanti Lodge')
    expect(screen.getByText('Bed size')).toBeInTheDocument()
    expect(screen.getByText('King')).toBeInTheDocument()
  })

  it('leaves out the item details group when a product listing has no specs', async () => {
    server.use(http.get('http://localhost:8000/api/listings/1/', () => HttpResponse.json({ ...LISTING, specs: [] })))
    renderPage()
    await screen.findByText('Royal Ashanti Lodge')
    expect(screen.queryByRole('button', { name: 'Item details' })).not.toBeInTheDocument()
    expect(screen.queryByText('No specs listed yet.')).not.toBeInTheDocument()
  })

  it('renders the service duration for a service listing', async () => {
    server.use(http.get('http://localhost:8000/api/listings/2/', () => HttpResponse.json(SERVICE_LISTING)))
    renderPage({ id: 2 })
    await screen.findByText('Kumasi City Tour')
    expect(screen.getByText('3 hours')).toBeInTheDocument()
  })

  it('shows the empty duration state when a service listing has no duration set', async () => {
    server.use(http.get('http://localhost:8000/api/listings/2/', () => HttpResponse.json({ ...SERVICE_LISTING, service_duration: '' })))
    renderPage({ id: 2 })
    await screen.findByText('Kumasi City Tour')
    expect(screen.getByText('Duration not specified')).toBeInTheDocument()
  })
})

describe('ListingDetailPage — Reviews tab', () => {
  it('shows the review aggregate and the review list', async () => {
    server.use(
      http.get('http://localhost:8000/api/listings/1/', () => HttpResponse.json(LISTING)),
      http.get('http://localhost:8000/api/reviews/listing/1/', () => HttpResponse.json({
        count: 1, next: null, previous: null,
        results: [{ id: 5, author_name: 'Kwame', rating: 5, comment: 'Loved it, would stay again.', verified: true, created_at: '2026-07-01T00:00:00Z' }],
        avg_rating: 5, review_count: 1, distribution: { 5: 1, 4: 0, 3: 0, 2: 0, 1: 0 },
      })),
    )
    renderPage()
    await screen.findByText('Royal Ashanti Lodge')
    expect(await screen.findByText('Loved it, would stay again.')).toBeInTheDocument()
    expect(screen.getByText('Kwame')).toBeInTheDocument()
    expect(screen.getByTestId('review-histogram')).toHaveTextContent('1 rating')
  })

  it('prompts a signed-out visitor to sign in before writing a review', async () => {
    server.use(http.get('http://localhost:8000/api/listings/1/', () => HttpResponse.json(LISTING)))
    renderPage({ user: null })
    await screen.findByText('Royal Ashanti Lodge')
    expect(await screen.findByText('Sign in to leave a review')).toBeInTheDocument()
  })

  it('shows the write form for an eligible signed-in customer', async () => {
    server.use(
      http.get('http://localhost:8000/api/listings/1/', () => HttpResponse.json(LISTING)),
      http.get('http://localhost:8000/api/reviews/eligibility/', () => HttpResponse.json({ eligible: true, already_reviewed: false })),
    )
    renderPage({ user: { id: 1, fullName: 'Ama', accountType: 'customer' } })
    await screen.findByText('Royal Ashanti Lodge')
    expect(await screen.findByPlaceholderText('Share your experience...')).toBeInTheDocument()
  })

  it('shows "already reviewed" for a customer who has already reviewed this listing', async () => {
    server.use(
      http.get('http://localhost:8000/api/listings/1/', () => HttpResponse.json(LISTING)),
      http.get('http://localhost:8000/api/reviews/eligibility/', () => HttpResponse.json({ eligible: false, already_reviewed: true })),
    )
    renderPage({ user: { id: 1, fullName: 'Ama', accountType: 'customer' } })
    await screen.findByText('Royal Ashanti Lodge')
    expect(await screen.findByText("You've already reviewed this.")).toBeInTheDocument()
  })

  it('shows the purchase-required note for an ineligible customer', async () => {
    server.use(
      http.get('http://localhost:8000/api/listings/1/', () => HttpResponse.json(LISTING)),
      http.get('http://localhost:8000/api/reviews/eligibility/', () => HttpResponse.json({ eligible: false, already_reviewed: false })),
    )
    renderPage({ user: { id: 1, fullName: 'Ama', accountType: 'customer' } })
    await screen.findByText('Royal Ashanti Lodge')
    expect(await screen.findByText('You can review this after a completed purchase.')).toBeInTheDocument()
  })
})

describe('ListingDetailPage — Compare tab', () => {
  const RELATED = [
    { id: 2, name: 'Adum Guest House', category: LISTING.category, price_amount: '300.00', price_unit: '/night', avg_rating: 4, review_count: 5, zone: { name: 'Adum' } },
    { id: 3, name: 'Kejetia Inn', category: LISTING.category, price_amount: '250.00', price_unit: '/night', avg_rating: 3.5, review_count: 2, zone: { name: 'Kejetia' } },
    { id: 4, name: 'Suame Suites', category: LISTING.category, price_amount: '400.00', price_unit: '/night', avg_rating: 0, review_count: 0, zone: { name: 'Suame' } },
  ]

  // Compare lives on the service/stay page; the product page has carousels instead.
  it('prompts for a second selection, caps selection at two, then renders a comparison table', async () => {
    server.use(
      http.get('http://localhost:8000/api/listings/2/', () => HttpResponse.json(SERVICE_LISTING)),
      http.get('http://localhost:8000/api/listings/2/related/', () => HttpResponse.json(RELATED)),
    )
    renderPage({ id: 2 })
    await screen.findByText('Kumasi City Tour')
    expect(await screen.findByText('Select two listings to compare.')).toBeInTheDocument()

    fireEvent.click(screen.getAllByRole('checkbox')[0])
    expect(screen.getByText('Select two listings to compare.')).toBeInTheDocument()

    fireEvent.click(screen.getAllByRole('checkbox')[1])
    expect(screen.queryByText('Select two listings to compare.')).not.toBeInTheDocument()
    expect(screen.getAllByRole('checkbox')[2]).toBeDisabled()
  })
})

describe('ListingDetailPage — Warranty & dispute tabs', () => {
  it('renders the warranty policy text for a product listing', async () => {
    server.use(
      http.get('http://localhost:8000/api/listings/1/', () => HttpResponse.json(LISTING)),
      http.get('http://localhost:8000/api/core/site-settings/', () => HttpResponse.json({
        contact_email: '', contact_phone: '', contact_address: '',
        facebook_url: '', instagram_url: '', linkedin_url: '', twitter_url: '',
        warranty_returns_policy: 'Returns accepted within 7 days of purchase.',
        service_dispute_policy: '',
      })),
    )
    renderPage()
    await screen.findByText('Royal Ashanti Lodge')
    expect(await screen.findByText('Returns accepted within 7 days of purchase.')).toBeInTheDocument()
  })

  it('leaves out the warranty group when neither the listing nor AshantiHub has published one', async () => {
    server.use(http.get('http://localhost:8000/api/listings/1/', () => HttpResponse.json(LISTING)))
    renderPage()
    await screen.findByText('Royal Ashanti Lodge')
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByRole('button', { name: 'Warranty & returns' })).not.toBeInTheDocument()
    expect(screen.queryByText('No policy has been published yet.')).not.toBeInTheDocument()
  })

  it('renders the dispute policy text for a service listing', async () => {
    server.use(
      http.get('http://localhost:8000/api/listings/2/', () => HttpResponse.json(SERVICE_LISTING)),
      http.get('http://localhost:8000/api/core/site-settings/', () => HttpResponse.json({
        contact_email: '', contact_phone: '', contact_address: '',
        facebook_url: '', instagram_url: '', linkedin_url: '', twitter_url: '',
        warranty_returns_policy: '',
        service_dispute_policy: 'Disputes are mediated by AshantiHub support within 48 hours.',
      })),
    )
    renderPage({ id: 2 })
    await screen.findByText('Kumasi City Tour')
    expect(await screen.findByText('Disputes are mediated by AshantiHub support within 48 hours.')).toBeInTheDocument()
  })
})

describe('ListingDetailPage — seller-rating badge', () => {
  it('shows the seller rating when the seller has reviews', async () => {
    server.use(
      http.get('http://localhost:8000/api/listings/1/', () => HttpResponse.json(LISTING)),
      http.get('http://localhost:8000/api/reviews/seller/9/', () => HttpResponse.json({
        count: 1, next: null, previous: null,
        results: [{ id: 8, author_name: 'Kojo', rating: 5, comment: 'Great seller!', verified: true, created_at: '2026-07-01T00:00:00Z' }],
        avg_rating: 4.6, review_count: 32,
      })),
    )
    renderPage()
    await screen.findByText('Royal Ashanti Lodge')
    expect(await screen.findByText(/⭐ 4.6 · Sold by Ama Boateng · 32 seller reviews/)).toBeInTheDocument()
  })

  it('shows just "Sold by" with no fabricated rating when the seller has no reviews yet', async () => {
    server.use(http.get('http://localhost:8000/api/listings/1/', () => HttpResponse.json(LISTING)))
    renderPage()
    await screen.findByText('Royal Ashanti Lodge')
    expect(await screen.findByRole('button', { name: /^Sold by Ama Boateng/ })).toBeInTheDocument()
  })

  it('expands to show the seller review list when clicked', async () => {
    server.use(
      http.get('http://localhost:8000/api/listings/1/', () => HttpResponse.json(LISTING)),
      http.get('http://localhost:8000/api/reviews/seller/9/', () => HttpResponse.json({
        count: 1, next: null, previous: null,
        results: [{ id: 8, author_name: 'Kojo', rating: 5, comment: 'Great seller!', verified: true, created_at: '2026-07-01T00:00:00Z' }],
        avg_rating: 4.6, review_count: 1,
      })),
    )
    renderPage()
    await screen.findByText('Royal Ashanti Lodge')
    fireEvent.click(await screen.findByRole('button', { name: /Sold by Ama Boateng/ }))
    expect(await screen.findByText('Great seller!')).toBeInTheDocument()
  })

  it('renders nothing when the listing has no business_owner', async () => {
    server.use(http.get('http://localhost:8000/api/listings/1/', () => HttpResponse.json({ ...LISTING, business_owner: null })))
    renderPage()
    await screen.findByText('Royal Ashanti Lodge')
    expect(screen.queryByText(/Sold by/)).not.toBeInTheDocument()
  })
})

// A staff session browses the marketplace view-only: the buy box looks the
// same as a customer's, but every buy/book/request/review action shows the one
// shared staff notice instead of proceeding (the server 403s staff anyway).
const STAFF = { id: 3, fullName: 'Akosua Support', accountType: 'staff' }
const STAFF_NOTICE = "Staff accounts can't shop or sell. Sign out first."

describe('ListingDetailPage — staff session is view-only', () => {
  it('Add to Cart shows the staff notice instead of adding (not the business-account wording)', async () => {
    server.use(http.get('http://localhost:8000/api/listings/1/', () => HttpResponse.json(LISTING)))
    const onAddToCart = vi.fn()
    renderPage({ user: STAFF, onAddToCart })
    await screen.findByText('Royal Ashanti Lodge')
    expect(screen.queryByText(/Business accounts can't purchase/i)).not.toBeInTheDocument()
    const before = screen.queryAllByText(STAFF_NOTICE).length
    fireEvent.click(screen.getByRole('button', { name: 'Add to cart' }))
    expect(screen.getAllByText(STAFF_NOTICE)).toHaveLength(before + 1)
    expect(onAddToCart).not.toHaveBeenCalled()
  })

  it('booking a stay shows the staff notice and never POSTs /api/bookings/', async () => {
    let bookingPosts = 0
    server.use(
      http.get('http://localhost:8000/api/listings/1/', () => HttpResponse.json({
        ...LISTING, category: { ...LISTING.category, is_accommodation: true },
      })),
      http.post('http://localhost:8000/api/bookings/', () => {
        bookingPosts += 1
        return HttpResponse.json({}, { status: 201 })
      }),
    )
    renderPage({ user: STAFF })
    await screen.findByText('Royal Ashanti Lodge')
    fireEvent.change(screen.getByLabelText('Check-in'), { target: { value: '2026-11-01' } })
    fireEvent.change(screen.getByLabelText('Check-out'), { target: { value: '2026-11-03' } })
    const before = screen.queryAllByText(STAFF_NOTICE).length
    fireEvent.click(screen.getByRole('button', { name: /^Book/ }))
    expect(screen.getAllByText(STAFF_NOTICE)).toHaveLength(before + 1)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(bookingPosts).toBe(0)
  })

  it('requesting a service shows the staff notice and never POSTs a service request', async () => {
    let requestPosts = 0
    server.use(
      http.get('http://localhost:8000/api/listings/2/', () => HttpResponse.json(SERVICE_LISTING)),
      http.post('http://localhost:8000/api/services/requests/', () => {
        requestPosts += 1
        return HttpResponse.json({}, { status: 201 })
      }),
    )
    renderPage({ id: 2, user: STAFF })
    await screen.findByText('Kumasi City Tour')
    fireEvent.change(screen.getByPlaceholderText('Describe what you need…'), { target: { value: 'A morning tour' } })
    const before = screen.queryAllByText(STAFF_NOTICE).length
    fireEvent.click(screen.getByRole('button', { name: 'Request this service' }))
    expect(screen.getAllByText(STAFF_NOTICE)).toHaveLength(before + 1)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(requestPosts).toBe(0)
  })

  it('the write-a-review box shows the staff notice and never asks the customer-only eligibility endpoint', async () => {
    let eligibilityCalls = 0
    server.use(
      http.get('http://localhost:8000/api/listings/1/', () => HttpResponse.json(LISTING)),
      http.get('http://localhost:8000/api/reviews/eligibility/', () => {
        eligibilityCalls += 1
        return HttpResponse.json({ eligible: false, already_reviewed: false })
      }),
    )
    renderPage({ user: STAFF })
    await screen.findByText('Royal Ashanti Lodge')
    expect(await screen.findByText(STAFF_NOTICE)).toBeInTheDocument()
    expect(screen.queryByText('You can review this after a completed purchase.')).not.toBeInTheDocument()
    expect(eligibilityCalls).toBe(0)
  })
})

describe('ListingDetailPage and the delivery cart', () => {
  const CUSTOMER = { fullName: 'Ama Boateng', accountType: 'customer' }
  const guard = (blocked) => http.get('http://localhost:8000/api/cart/guard/', () => HttpResponse.json({ active: true, limits: {}, shops: [], food_shops: 0, at_shop_limit: true, at_food_limit: false, checkout: { any: null, door_to_door: null }, listing: { id: 1, blocked } }))

  it('a customer at the delivery limit sees the reason instead of Add to Cart', async () => {
    server.use(http.get('http://localhost:8000/api/listings/1/', () => HttpResponse.json(LISTING)), guard({ detail: 'Your delivery can include up to 4 shops. Remove one to add this.', code: 'shop_limit' }))
    renderPage({ user: CUSTOMER })
    expect(await screen.findByText('Delivery limit reached')).toBeInTheDocument()
    expect(screen.getByText('Your delivery can include up to 4 shops. Remove one to add this.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add to cart' })).toBeDisabled()
  })

  it('food is added to the cart, not requested as a service', async () => {
    const food = { ...LISTING, category: { slug: 'food', icon: '🍲', label: 'Food', color: '#CC0000', kind: 'service', is_food: true } }
    server.use(http.get('http://localhost:8000/api/listings/1/', () => HttpResponse.json(food)), guard(null))
    renderPage({ user: CUSTOMER })
    expect(await screen.findByRole('button', { name: 'Add to cart' })).toBeInTheDocument()
    expect(screen.queryByText('Request this service')).not.toBeInTheDocument()
  })

  it("a refused add shows the server's reason", async () => {
    server.use(
      http.get('http://localhost:8000/api/listings/1/', () => HttpResponse.json(LISTING)), guard(null),
      http.post('http://localhost:8000/api/cart/items/', () => HttpResponse.json({ detail: 'Your delivery can include food from up to 2 places. Remove one to add this.', code: 'food_limit' }, { status: 400 })),
    )
    renderPage({ user: CUSTOMER })
    fireEvent.click(await screen.findByRole('button', { name: 'Add to cart' }))
    expect(await screen.findByText('Your delivery can include food from up to 2 places. Remove one to add this.')).toBeInTheDocument()
  })

  it('guests and business accounts never read the cart guard', async () => {
    let guardCalls = 0
    server.use(http.get('http://localhost:8000/api/listings/1/', () => HttpResponse.json(LISTING)), http.get('http://localhost:8000/api/cart/guard/', () => { guardCalls += 1; return HttpResponse.json({}) }))
    renderPage({ user: null })
    await screen.findByText('Royal Ashanti Lodge')
    renderPage({ user: { id: 5, fullName: 'Biz Owner', accountType: 'business_owner' } })
    await new Promise((r) => setTimeout(r, 100))
    expect(guardCalls).toBe(0)
  })

  it('a service is requested and a stay is booked, never added to the cart, even for a customer', async () => {
    server.use(http.get('http://localhost:8000/api/listings/2/', () => HttpResponse.json(SERVICE_LISTING)), guard(null))
    const { unmount } = renderPage({ id: 2, user: CUSTOMER })
    expect(await screen.findByText('Request this service', { selector: 'button' })).toBeInTheDocument()
    expect(screen.queryByText('Add to Cart')).not.toBeInTheDocument()
    unmount()
    server.use(http.get('http://localhost:8000/api/listings/1/', () => HttpResponse.json({ ...LISTING, category: { ...LISTING.category, is_accommodation: true } })), guard(null))
    renderPage({ user: CUSTOMER })
    expect(await screen.findByRole('button', { name: /^Book/ })).toBeInTheDocument()
    expect(screen.queryByText('Add to Cart')).not.toBeInTheDocument()
  })

  it('a food place too far shows "Too far for this delivery"', async () => {
    server.use(http.get('http://localhost:8000/api/listings/1/', () => HttpResponse.json(LISTING)), guard({ detail: 'This food place is more than 3 km from the shops in your cart, so one rider cannot collect it on the same trip.', code: 'food_far' }))
    renderPage({ user: CUSTOMER })
    expect(await screen.findByText('Too far for this delivery')).toBeInTheDocument()
    expect(screen.queryByText('Delivery limit reached')).not.toBeInTheDocument()
  })

  it('a refused service or stay shows the server message, not "Delivery limit reached"', async () => {
    const msg = 'Services, stays and events cannot be delivered. Book or enquire directly.'
    server.use(http.get('http://localhost:8000/api/listings/1/', () => HttpResponse.json(LISTING)), guard({ detail: msg, code: 'not_deliverable' }))
    renderPage({ user: CUSTOMER })
    expect(await screen.findByText(msg)).toBeInTheDocument()
    expect(screen.queryByText('Delivery limit reached')).not.toBeInTheDocument()
  })
})

describe('ListingDetailPage — policy and timing shown before paying (plan 7E)', () => {
  const CUSTOMER = { id: 5, fullName: 'Kofi', accountType: 'customer' }
  const STAY = { ...LISTING, id: 3, cancellation_policy: 'moderate', category: { ...LISTING.category, kind: 'service', is_accommodation: true } }

  it('a stay shows the exact cancellation times and when the host is paid once dates are chosen', async () => {
    server.use(http.get('http://localhost:8000/api/listings/3/', () => HttpResponse.json(STAY)))
    renderPage({ id: 3, user: CUSTOMER })
    await screen.findByText('Book your stay')
    expect(screen.queryByTestId('booking-terms')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Check-in'), { target: { value: '2030-06-10' } })
    expect(await screen.findByText('Free cancellation until Wed 5 Jun, 14:00')).toBeInTheDocument()
    expect(screen.getByText('50% refund until Sun 9 Jun, 14:00')).toBeInTheDocument()
    expect(screen.getByText(/The host is paid 24 hours after check-in time, on Tue 11 Jun, 14:00/)).toBeInTheDocument()
  })

  it('a service shows when it can be cancelled and when the business is paid', async () => {
    server.use(http.get('http://localhost:8000/api/listings/2/', () => HttpResponse.json({ ...SERVICE_LISTING, cancellation_policy: 'strict' })))
    renderPage({ id: 2, user: CUSTOMER })
    expect(await screen.findByText(/any time before the business marks the job done/)).toBeInTheDocument()
    expect(screen.getByText(/accepted automatically 48 hours after the business marks it done/)).toBeInTheDocument()
  })

  it('a stay shows nothing about cancellation or payout while the ledger is off', async () => {
    server.use(
      http.get('http://localhost:8000/api/listings/3/', () => HttpResponse.json(STAY)),
      http.get('http://localhost:8000/api/ledger/booking-terms/', () => HttpResponse.json({ enabled: false, policies: {} })),
    )
    renderPage({ id: 3, user: CUSTOMER })
    await screen.findByText('Book your stay')
    fireEvent.change(screen.getByLabelText('Check-in'), { target: { value: '2030-06-10' } })
    await new Promise((r) => setTimeout(r, 80))
    expect(screen.queryByTestId('booking-terms')).not.toBeInTheDocument()
  })

  it('a product shows no policy or release timing', async () => {
    server.use(http.get('http://localhost:8000/api/listings/1/', () => HttpResponse.json({ ...LISTING, category: { ...LISTING.category, kind: 'product' } })))
    renderPage({ user: CUSTOMER })
    await screen.findByText('Royal Ashanti Lodge')
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByTestId('booking-terms')).not.toBeInTheDocument()
  })
})

// Before opening (gate on) Add to Cart and Book are greyed with the opening date.
describe('ListingDetailPage — before the marketplace opens', () => {
  const CUSTOMER = { id: 4, fullName: 'Ama Boateng', accountType: 'customer' }
  function gated(canBuy, listing = LISTING) {
    server.use(
      gatedOpening({ opensAt: '2026-11-06T06:00:00Z', serverNow: '2026-11-01T06:00:00Z' }),
      http.get('http://localhost:8000/api/accounts/me/', () => HttpResponse.json({ id: 4, can_buy: canBuy })),
      http.get('http://localhost:8000/api/listings/1/', () => HttpResponse.json(listing)),
    )
    setStoredAuth({ token: 't', account_type: 'customer' })
  }

  it('buy_disabled_with_opens_label_before_opening: Add to Cart', async () => {
    gated(false)
    try {
      renderPage({ user: CUSTOMER })
      await screen.findByText('Royal Ashanti Lodge')
      expect(await screen.findByRole('button', { name: 'Opens 6 Nov' })).toBeDisabled()
      expect(screen.queryByRole('button', { name: 'Add to cart' })).not.toBeInTheDocument()
    } finally { setStoredAuth(null) }
  })

  it('a signed-out visitor sees the same disabled state', async () => {
    server.use(
      gatedOpening({ opensAt: '2026-11-06T06:00:00Z', serverNow: '2026-11-01T06:00:00Z' }),
      http.get('http://localhost:8000/api/listings/1/', () => HttpResponse.json(LISTING)),
    )
    renderPage()
    await screen.findByText('Royal Ashanti Lodge')
    expect(await screen.findByRole('button', { name: 'Opens 6 Nov' })).toBeDisabled()
  })

  it('enabled_when_can_buy_true: Add to Cart stays live for an allowlisted tester', async () => {
    gated(true)
    try {
      renderPage({ user: CUSTOMER })
      await screen.findByText('Royal Ashanti Lodge')
      await waitFor(() => expect(screen.getByRole('button', { name: 'Add to cart' })).not.toBeDisabled())
    } finally { setStoredAuth(null) }
  })

  it('buy_disabled_with_opens_label_before_opening: Book a stay', async () => {
    gated(false, { ...LISTING, category: { ...LISTING.category, is_accommodation: true } })
    try {
      renderPage({ user: CUSTOMER })
      await screen.findByText('Royal Ashanti Lodge')
      fireEvent.change(screen.getByLabelText('Check-in'), { target: { value: '2026-11-08' } })
      fireEvent.change(screen.getByLabelText('Check-out'), { target: { value: '2026-11-10' } })
      expect(await screen.findByRole('button', { name: 'Opens 6 Nov' })).toBeDisabled()
      expect(screen.queryByRole('button', { name: /^Book/ })).not.toBeInTheDocument()
    } finally { setStoredAuth(null) }
  })
})

describe('ListingDetailPage price', () => {
  it('shows effective_price and strikes through only was_price', async () => {
    server.use(http.get('http://localhost:8000/api/listings/1/', () => HttpResponse.json({ ...LISTING, sale_price: '400.00', effective_price: '400.00', was_price: '450.00' })))
    const { container } = renderPage()
    await screen.findByText('Royal Ashanti Lodge')
    const price = screen.getByTestId('product-price')
    expect(within(price).getByText('GHS 400.00')).toBeInTheDocument()
    expect(price).toHaveTextContent('/night')
    expect(within(price).getByText('Was GHS 450.00')).toBeInTheDocument()
    // The centre price and the buy box each strike the server's was_price, and nothing else.
    const struck = [...container.querySelectorAll('s')].map((s) => s.textContent)
    expect(struck).toEqual(['GHS 450.00', 'GHS 450.00'])
  })

  it('does not strike through price_amount when the sale has no honest was price', async () => {
    server.use(http.get('http://localhost:8000/api/listings/1/', () => HttpResponse.json({ ...LISTING, sale_price: '400.00', effective_price: '400.00', was_price: null })))
    const { container } = renderPage()
    await screen.findByText('Royal Ashanti Lodge')
    expect(within(screen.getByTestId('product-price')).getByText('GHS 400.00')).toBeInTheDocument()
    expect(container.querySelector('s')).toBeNull()
  })
})

// Plan 2 task 10: sections show only what the listing really offers.
const VARIANT_BASE = { price_amount: '50.00', effective_price: '50.00', sale_price: null, was_price: null, sale_ends_at: null, attributes: {}, position: 0 }
const WITH_VARIANTS = {
  ...LISTING,
  id: 1,
  category: { ...LISTING.category, kind: 'product' },
  price_unit: '',
  price_amount: '50.00',
  has_variants: true,
  // `available` is on every variant of the detail response (backend-contract A10).
  variants: [
    { ...VARIANT_BASE, id: 11, label: 'Small', stock_quantity: 3, available: true },
    { ...VARIANT_BASE, id: 12, label: 'Large', price_amount: '70.00', effective_price: '60.00', sale_price: '60.00', was_price: '70.00', stock_quantity: null, available: true },
    { ...VARIANT_BASE, id: 13, label: 'Giant', stock_quantity: 0, available: false },
    { ...VARIANT_BASE, id: 14, label: 'Mini', price_amount: '40.00', effective_price: '35.00', sale_price: '35.00', was_price: null, stock_quantity: 5, available: true },
  ],
}
function showListing(listing) {
  server.use(http.get('http://localhost:8000/api/listings/1/', () => HttpResponse.json(listing)))
}
const selectionRow = (label) => screen.getAllByTestId('selection-row').find((row) => within(row).queryByText(label))

// Goods use the product page's picker: one chip per option; a picked option gets its own row and quantity.
describe('ListingDetailPage — variants', () => {
  it('each picked option gets a row, striking through a price only when was_price is set', async () => {
    showListing(WITH_VARIANTS)
    renderPage()
    await screen.findByText('Royal Ashanti Lodge')
    const picker = screen.getByTestId('variant-picker')
    fireEvent.click(within(picker).getByRole('button', { name: 'Large' }))
    fireEvent.click(within(picker).getByRole('button', { name: 'Mini' }))
    expect(within(picker).getAllByTestId('selection-row')).toHaveLength(2)
    const large = selectionRow('Large')
    expect(within(large).getByText('GHS 60.00')).toBeInTheDocument()
    expect([...large.querySelectorAll('s')].map((n) => n.textContent)).toEqual(['GHS 70.00'])
    const mini = selectionRow('Mini')
    expect(within(mini).getByText('GHS 35.00')).toBeInTheDocument()
    expect(mini.querySelector('s')).toBeNull()
  })

  it('a sold-out option cannot be picked', async () => {
    showListing(WITH_VARIANTS)
    renderPage()
    await screen.findByText('Royal Ashanti Lodge')
    const giant = screen.getByRole('button', { name: 'Giant' })
    expect(giant).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(giant)
    expect(screen.queryAllByTestId('selection-row')).toHaveLength(0)
  })

  it('bounds the stepper by stock when stock is counted, and leaves it open when it is not', async () => {
    showListing(WITH_VARIANTS)
    renderPage()
    await screen.findByText('Royal Ashanti Lodge')
    fireEvent.click(screen.getByRole('button', { name: 'Small' }))
    for (let i = 0; i < 6; i++) fireEvent.click(screen.getByRole('button', { name: 'Increase quantity of Small' }))
    expect(within(selectionRow('Small')).getByTestId('qty-value')).toHaveTextContent('3')
    expect(within(selectionRow('Small')).getByText('Only 3 left')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Large' }))
    for (let i = 0; i < 6; i++) fireEvent.click(screen.getByRole('button', { name: 'Increase quantity of Large' }))
    expect(within(selectionRow('Large')).getByTestId('qty-value')).toHaveTextContent('7')
  })

  it('adds only the rows with a quantity, as lines', async () => {
    const posts = []
    server.use(http.post('http://localhost:8000/api/cart/items/bulk/', async ({ request }) => {
      posts.push(await request.json())
      return HttpResponse.json({ id: 1, items: [], total: '135.00' }, { status: 201 })
    }))
    showListing(WITH_VARIANTS)
    const onAddToCart = vi.fn().mockResolvedValue(undefined)
    renderPage({ user: { id: 4, fullName: 'Ama', accountType: 'customer' }, onAddToCart })
    await screen.findByText('Royal Ashanti Lodge')
    expect(screen.getByRole('button', { name: 'Choose options' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Small' }))
    fireEvent.click(screen.getByRole('button', { name: 'Increase quantity of Small' }))
    fireEvent.click(screen.getByRole('button', { name: 'Mini' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add to cart' }))
    expect(await screen.findByText('Added to cart ✓')).toBeInTheDocument()
    expect(posts).toEqual([{ listing: 1, lines: [{ variant: 11, quantity: 2 }, { variant: 14, quantity: 1 }] }])
    expect(onAddToCart).not.toHaveBeenCalled()
  })

  it('labels the price of a listing with options "From"', async () => {
    showListing(WITH_VARIANTS)
    renderPage()
    await screen.findByText('Royal Ashanti Lodge')
    expect(screen.getByTestId('product-price')).toHaveTextContent(/^From\s*GHS/)
  })

  it('keeps the single Add to cart for a listing without variants', async () => {
    showListing({ ...LISTING, variants: [], has_variants: false })
    renderPage()
    await screen.findByText('Royal Ashanti Lodge')
    expect(screen.queryByTestId('variant-picker')).toBeNull()
    expect(screen.getByRole('button', { name: 'Add to cart' })).toBeInTheDocument()
  })

  it('shows the staff notice instead of adding for a staff session', async () => {
    showListing(WITH_VARIANTS)
    const onAddToCart = vi.fn()
    renderPage({ user: STAFF, onAddToCart })
    await screen.findByText('Royal Ashanti Lodge')
    fireEvent.click(screen.getByRole('button', { name: 'Small' }))
    const before = screen.queryAllByText(STAFF_NOTICE).length
    fireEvent.click(screen.getByRole('button', { name: 'Add to cart' }))
    expect(screen.getAllByText(STAFF_NOTICE)).toHaveLength(before + 1)
    expect(onAddToCart).not.toHaveBeenCalled()
  })

  it('is greyed with the opening date before the marketplace opens', async () => {
    server.use(
      gatedOpening({ opensAt: '2026-11-06T06:00:00Z', serverNow: '2026-11-01T06:00:00Z' }),
      http.get('http://localhost:8000/api/accounts/me/', () => HttpResponse.json({ id: 4, can_buy: false })),
    )
    showListing(WITH_VARIANTS)
    setStoredAuth({ token: 't', account_type: 'customer' })
    try {
      renderPage({ user: { id: 4, fullName: 'Ama', accountType: 'customer' } })
      await screen.findByText('Royal Ashanti Lodge')
      expect(await screen.findByRole('button', { name: 'Opens 6 Nov' })).toBeDisabled()
      expect(screen.queryByRole('button', { name: 'Add to cart' })).toBeNull()
    } finally { setStoredAuth(null) }
  })
})

describe('ListingDetailPage — videos and seller link', () => {
  const YT = { id: 2, kind: 'youtube', youtube_id: 'dQw4w9WgXcQ', poster: null, position: 1 }
  const UP = { id: 1, kind: 'upload', url: 'http://localhost:8000/media/v/1.mp4', poster: 'http://localhost:8000/media/v/1.jpg', position: 0 }

  // Inline players are the service/stay page's; goods play videos in the gallery viewer.
  const showService = (listing) => server.use(http.get('http://localhost:8000/api/listings/2/', () => HttpResponse.json(listing)))

  it('plays an uploaded video in a controls player with its poster', async () => {
    showService({ ...SERVICE_LISTING, videos: [UP] })
    const { container } = renderPage({ id: 2 })
    await screen.findByText('Kumasi City Tour')
    const video = container.querySelector('video')
    expect(video).toHaveAttribute('controls')
    expect(video).toHaveAttribute('src', UP.url)
    expect(video).toHaveAttribute('poster', UP.poster)
  })

  it('embeds a YouTube video through youtube-nocookie only for a well-formed id', async () => {
    showService({ ...SERVICE_LISTING, videos: [YT, { id: 3, kind: 'youtube', youtube_id: 'bad"><script>', poster: null, position: 2 }] })
    const { container } = renderPage({ id: 2 })
    await screen.findByText('Kumasi City Tour')
    const frames = container.querySelectorAll('iframe')
    expect(frames).toHaveLength(1)
    expect(frames[0]).toHaveAttribute('src', 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ')
  })

  it('renders no video section for a listing without videos', async () => {
    showListing({ ...LISTING, videos: [] })
    const { container } = renderPage()
    await screen.findByText('Royal Ashanti Lodge')
    expect(container.querySelector('video, iframe')).toBeNull()
    expect(screen.queryByTestId('media-videos')).toBeNull()
  })

  it('links "Sold by <business>" to the seller page, with no contact action', async () => {
    showListing(LISTING)
    const onOpenSeller = vi.fn()
    renderPage({ onOpenSeller })
    await screen.findByText('Royal Ashanti Lodge')
    // The buy box's "Sold by" line links the business name itself.
    const link = within(screen.getByTestId('buy-box')).getByRole('link', { name: 'Ama Boateng' })
    expect(link).toHaveAttribute('href', '/seller/9')
    fireEvent.click(link)
    expect(onOpenSeller).toHaveBeenCalledWith(9)
  })

  it('has no seller link when the listing has no business_owner', async () => {
    showListing({ ...LISTING, business_owner: null })
    const { container } = renderPage()
    await screen.findByText('Royal Ashanti Lodge')
    expect(container.querySelector('a[href^="/seller/"]')).toBeNull()
  })
})

describe('ListingDetailPage — Ashanti Direct (marketplace plan 2)', () => {
  it('product page shows the Ashanti Direct badge only when the API says so', async () => {
    showListing({ ...LISTING, business_owner: { id: 3, full_name: 'ops login', name: 'Ashanti Direct', kyc_status: 'verified', is_ashanti_direct: true } })
    renderPage()
    await screen.findByText('Royal Ashanti Lodge')
    expect(within(screen.getByTestId('buy-box')).getByRole('link', { name: 'Ashanti Direct' })).toBeInTheDocument()
    expect(screen.getByText('Ashanti Direct', { selector: 'span' })).toBeInTheDocument()
  })

  it('no badge for a partner', async () => {
    showListing({ ...LISTING, business_owner: { id: 9, full_name: 'Ama Boateng', name: 'Ama Boateng Crafts', kyc_status: 'verified', is_ashanti_direct: false } })
    renderPage()
    await screen.findByText('Royal Ashanti Lodge')
    expect(within(screen.getByTestId('buy-box')).getByRole('link', { name: 'Ama Boateng Crafts' })).toBeInTheDocument()
    expect(screen.queryByText('Ashanti Direct')).not.toBeInTheDocument()
  })

  it('clears the variant selection when the page switches to another listing', async () => {
    server.use(
      http.get('http://localhost:8000/api/listings/1/', () => HttpResponse.json(WITH_VARIANTS)),
      http.get('http://localhost:8000/api/listings/2/', () => HttpResponse.json({ ...WITH_VARIANTS, id: 2, name: 'Second thing' })),
    )
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const tree = (id) => (
      <QueryClientProvider client={queryClient}>
        <ListingDetailPage id={id} onBack={vi.fn()} user={null} favourites={[]} onFavourite={vi.fn()} currency="GHS" onMessage={vi.fn()} onAddToCart={vi.fn()} CardComponent={StubCard} />
      </QueryClientProvider>
    )
    const { rerender } = render(tree(1))
    await screen.findByText('Royal Ashanti Lodge')
    fireEvent.click(screen.getByRole('button', { name: 'Small' }))
    expect(within(selectionRow('Small')).getByTestId('qty-value')).toHaveTextContent('1')
    rerender(tree(2))
    await screen.findByText('Second thing')
    expect(screen.queryAllByTestId('selection-row')).toHaveLength(0)
    expect(screen.getByRole('button', { name: 'Small' })).toHaveAttribute('aria-pressed', 'false')
  })
})

describe('ListingDetailPage — booking a stay with the wallet ledger (plan 1F)', () => {
  const API = 'http://localhost:8000'
  const CUSTOMER = { id: 5, fullName: 'Kofi', accountType: 'customer' }
  const STAY = { ...LISTING, id: 3, category: { ...LISTING.category, kind: 'service', is_accommodation: true } }
  let posts
  let quotes

  const setup = ({ ledgerOff = false, balance = '900.00', post } = {}) => {
    posts = []
    quotes = 0
    server.use(
      http.get(`${API}/api/listings/3/`, () => HttpResponse.json(STAY)),
      http.get(`${API}/api/wallet/`, () => (ledgerOff
        ? HttpResponse.json({ code: 'ledger_off', detail: 'Wallets are not switched on.' }, { status: 409 })
        : HttpResponse.json({ kind: 'customer', balance }))),
      http.get(`${API}/api/wallet/processing/`, ({ request }) => {
        const amount = new URL(request.url).searchParams.get('amount')
        return HttpResponse.json({ amount, payment_processing: '3.00', you_pay: '303.00', provider: 'simulated' })
      }),
      http.get(`${API}/api/bookings/availability/`, ({ request }) => {
        quotes += 1
        const q = new URL(request.url).searchParams
        return HttpResponse.json({
          units_free: 5, available: true, nights: 3, nightly_rate: '100.00', units: Number(q.get('units')), total_price: (300 * Number(q.get('units'))).toFixed(2),
        })
      }),
      http.post(`${API}/api/bookings/`, async ({ request }) => {
        posts.push(await request.json())
        return post ? post() : HttpResponse.json({ id: 1, status: 'confirmed', check_in: '2030-06-10', check_out: '2030-06-13', total_price: '300.00', payment_processing: '3.00' }, { status: 201 })
      }),
    )
  }
  const pickDates = async (PaymentComponent) => {
    renderPage({ id: 3, user: CUSTOMER, PaymentComponent })
    await screen.findByText('Book your stay')
    fireEvent.change(screen.getByLabelText('Check-in'), { target: { value: '2030-06-10' } })
    fireEvent.change(screen.getByLabelText('Check-out'), { target: { value: '2030-06-13' } })
  }

  it("with the ledger on the stay shows the server's total and processing before booking", async () => {
    setup()
    await pickDates()
    expect(await screen.findByTestId('stay-total')).toHaveTextContent('3 nights × 1: GH₵ 300.00')
    expect(await screen.findByTestId('processing-line')).toHaveTextContent('GH₵ 3.00')
    expect(screen.getByLabelText(/AshantiHub wallet/)).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Book and pay' })).not.toBeDisabled())
    expect(posts).toHaveLength(0)
  })

  it('book posts payment_method and follows a redirect', async () => {
    setup({ post: () => HttpResponse.json({ mode: 'redirect', checkout_url: 'https://pay.example/c/9' }) })
    const PaymentComponent = vi.fn(({ onSuccess }) => <button onClick={onSuccess}>confirm momo</button>)
    const original = window.location
    Object.defineProperty(window, 'location', { configurable: true, value: { href: 'http://localhost/' } })
    try {
      await pickDates(PaymentComponent)
      await screen.findByTestId('processing-line')
      await waitFor(() => expect(screen.getByRole('button', { name: 'Book and pay' })).not.toBeDisabled())
      fireEvent.click(screen.getByRole('button', { name: 'Book and pay' }))
      fireEvent.click(await screen.findByText('confirm momo'))
      await waitFor(() => expect(window.location.href).toBe('https://pay.example/c/9'))
      expect(posts).toEqual([{ listing: 3, check_in: '2030-06-10', check_out: '2030-06-13', units: 1, payment_method: 'momo' }])
      expect(PaymentComponent.mock.calls[0][0].processing).toBe('3.00')
      expect(screen.queryByText(/Booked!/)).not.toBeInTheDocument()
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: original })
    }
  })

  it('a wallet booking posts once', async () => {
    setup()
    const PaymentComponent = vi.fn(() => null)
    await pickDates(PaymentComponent)
    fireEvent.click(await screen.findByLabelText(/AshantiHub wallet/))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Book and pay' })).not.toBeDisabled())
    const book = screen.getByRole('button', { name: 'Book and pay' })
    fireEvent.click(book)
    fireEvent.click(book)
    expect(await screen.findByText(/Booked!/)).toHaveTextContent('Payment processing GH₵ 3.00')
    expect(posts).toEqual([{ listing: 3, check_in: '2030-06-10', check_out: '2030-06-13', units: 1, payment_method: 'wallet' }])
    expect(PaymentComponent).not.toHaveBeenCalled()
  })

  it('a 409 with a code shows the server text, not the dates message', async () => {
    setup({ post: () => HttpResponse.json({ code: 'insufficient_funds', detail: 'Your wallet balance is too low for this stay.' }, { status: 409 }) })
    await pickDates(() => null)
    fireEvent.click(await screen.findByLabelText(/AshantiHub wallet/))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Book and pay' })).not.toBeDisabled())
    fireEvent.click(screen.getByRole('button', { name: 'Book and pay' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Your wallet balance is too low for this stay.')
    expect(screen.queryByText(/Those dates aren't available/)).not.toBeInTheDocument()
  })

  it('a 409 without a code keeps the dates message', async () => {
    setup({ post: () => HttpResponse.json({ detail: 'Those dates aren\'t available for the number of units requested.' }, { status: 409 }) })
    await pickDates(() => null)
    fireEvent.click(await screen.findByLabelText(/AshantiHub wallet/))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Book and pay' })).not.toBeDisabled())
    fireEvent.click(screen.getByRole('button', { name: 'Book and pay' }))
    expect(await screen.findByText("Those dates aren't available — try different dates.")).toBeInTheDocument()
  })

  it('an unknown wallet answer blocks booking', async () => {
    setup()
    server.use(http.get(`${API}/api/wallet/`, () => HttpResponse.json({ detail: 'boom' }, { status: 500 })))
    await pickDates()
    await new Promise((r) => setTimeout(r, 120))
    expect(screen.queryByRole('button', { name: 'Book and pay' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Book/ })).toBeDisabled()
    expect(quotes).toBe(0)
    expect(posts).toHaveLength(0)
  })

  it('ledger off keeps the old stay flow and asks for no quote', async () => {
    setup({ ledgerOff: true })
    await pickDates()
    await waitFor(() => expect(screen.getByRole('button', { name: /^Book · GHS 450.00\/night/ })).not.toBeDisabled())
    await new Promise((r) => setTimeout(r, 80))
    expect(quotes).toBe(0)
    expect(screen.queryByTestId('stay-total')).not.toBeInTheDocument()
    expect(screen.queryByText('Pay with')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^Book/ }))
    expect(await screen.findByText(/Booked!/)).toBeInTheDocument()
    expect(posts).toEqual([{ listing: 3, check_in: '2030-06-10', check_out: '2030-06-13', units: 1 }])
  })

  it('a wallet failure shows its reason and keeps Book disabled', async () => {
    setup()
    server.use(http.get(`${API}/api/wallet/`, () => HttpResponse.json({ detail: 'boom' }, { status: 500 })))
    await pickDates()
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('boom')
    expect(screen.getByRole('button', { name: /^Book/ })).toBeDisabled()
    expect(posts).toHaveLength(0)
  })

  it('warns when fewer units are free than asked for', async () => {
    setup()
    server.use(http.get(`${API}/api/bookings/availability/`, () => HttpResponse.json({
      units_free: 1, available: true, nights: 3, nightly_rate: '100.00', units: 2, total_price: '600.00',
    })))
    await pickDates()
    fireEvent.change(screen.getByLabelText('Units / rooms'), { target: { value: '2' } })
    expect(await screen.findByText('Only 1 free for those dates.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Book and pay' })).toBeDisabled()
  })
})
