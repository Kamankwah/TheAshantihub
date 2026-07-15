import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { server } from './mocks/server.js'
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
  contact_phone: '+233244000001',
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
    expect(screen.getByText(/450/)).toBeInTheDocument()
  })

  it('renders a gallery thumbnail per photo', async () => {
    server.use(http.get('http://localhost:8000/api/listings/1/', () => HttpResponse.json(LISTING)))
    renderPage()
    await screen.findByText('Royal Ashanti Lodge')
    expect(screen.getByLabelText('View photo 1')).toBeInTheDocument()
    expect(screen.getByLabelText('View photo 2')).toBeInTheDocument()
  })

  it('renders an enabled Add to Cart button for a priced listing', async () => {
    server.use(http.get('http://localhost:8000/api/listings/1/', () => HttpResponse.json(LISTING)))
    renderPage()
    await screen.findByText('Royal Ashanti Lodge')
    expect(screen.getByText('Add to Cart')).not.toBeDisabled()
  })

  it('disables Add to Cart when the listing has no price', async () => {
    server.use(http.get('http://localhost:8000/api/listings/1/', () => HttpResponse.json({ ...LISTING, price_amount: null })))
    renderPage()
    await screen.findByText('Royal Ashanti Lodge')
    expect(screen.getByText('No Price Set')).toBeDisabled()
  })

  it('calls onAddToCart and shows an "Added" confirmation on success', async () => {
    server.use(http.get('http://localhost:8000/api/listings/1/', () => HttpResponse.json(LISTING)))
    const onAddToCart = vi.fn().mockResolvedValue(undefined)
    renderPage({ onAddToCart })
    await screen.findByText('Royal Ashanti Lodge')
    fireEvent.click(screen.getByText('Add to Cart'))
    expect(onAddToCart).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }), 1)
    expect(await screen.findByText('Added to Cart ✓')).toBeInTheDocument()
  })

  it('shows an error message next to the button when onAddToCart rejects', async () => {
    server.use(http.get('http://localhost:8000/api/listings/1/', () => HttpResponse.json(LISTING)))
    const onAddToCart = vi.fn().mockRejectedValue(new Error('Only customer accounts can add items to a cart.'))
    renderPage({ onAddToCart })
    await screen.findByText('Royal Ashanti Lodge')
    fireEvent.click(screen.getByText('Add to Cart'))
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

  it('renders related listings from useRelatedListings via the injected CardComponent', async () => {
    server.use(
      http.get('http://localhost:8000/api/listings/1/', () => HttpResponse.json(LISTING)),
      http.get('http://localhost:8000/api/listings/1/related/', () =>
        HttpResponse.json([{ id: 2, name: 'Adum Guest House', category: LISTING.category }]),
      ),
    )
    renderPage()
    await waitFor(() => expect(screen.getByTestId('related-rail')).toBeInTheDocument())
    expect(within(screen.getByTestId('related-rail')).getByText('Adum Guest House')).toBeInTheDocument()
  })

  it('forwards onOpenListing as onOpen to related CardComponent instances', async () => {
    server.use(
      http.get('http://localhost:8000/api/listings/1/', () => HttpResponse.json(LISTING)),
      http.get('http://localhost:8000/api/listings/1/related/', () =>
        HttpResponse.json([{ id: 2, name: 'Adum Guest House', category: LISTING.category }]),
      ),
    )
    const onOpenListing = vi.fn()
    renderPage({ onOpenListing })
    await waitFor(() => expect(screen.getByTestId('related-rail')).toBeInTheDocument())
    fireEvent.click(within(screen.getByTestId('related-rail')).getByText('Adum Guest House'))
    expect(onOpenListing).toHaveBeenCalledWith(2)
  })

  it('shows a retry option on error', async () => {
    server.use(http.get('http://localhost:8000/api/listings/1/', () => new HttpResponse(null, { status: 500 })))
    renderPage()
    expect(await screen.findByText('Could not load this listing.')).toBeInTheDocument()
  })
})

describe('ListingDetailPage — tabbed sections (reviews/ratings/Q&A Phase 5)', () => {
  it('renders the product tab set, in order, for a product listing', async () => {
    server.use(http.get('http://localhost:8000/api/listings/1/', () => HttpResponse.json(LISTING)))
    renderPage()
    await screen.findByText('Royal Ashanti Lodge')
    const tabLabels = screen.getAllByRole('tab').map((t) => t.textContent)
    expect(tabLabels).toEqual([
      'Overview', 'Specs', 'Reviews', 'Q&As', 'Compare Products', 'Warranty & Returns', 'More buying options',
    ])
  })

  it('renders the service tab set, in order, for a service listing', async () => {
    server.use(http.get('http://localhost:8000/api/listings/2/', () => HttpResponse.json(SERVICE_LISTING)))
    renderPage({ id: 2 })
    await screen.findByText('Kumasi City Tour')
    const tabLabels = screen.getAllByRole('tab').map((t) => t.textContent)
    expect(tabLabels).toEqual([
      'Overview', 'Service Duration', 'Reviews', 'Q&As', 'Compare Services', 'Service satisfaction & dispute', 'More Service options',
    ])
  })

  it('renders the specs table for a product listing', async () => {
    server.use(http.get('http://localhost:8000/api/listings/1/', () => HttpResponse.json(LISTING)))
    renderPage()
    await screen.findByText('Royal Ashanti Lodge')
    expect(screen.getByText('Bed size')).toBeInTheDocument()
    expect(screen.getByText('King')).toBeInTheDocument()
  })

  it('shows the empty specs state when a product listing has no specs', async () => {
    server.use(http.get('http://localhost:8000/api/listings/1/', () => HttpResponse.json({ ...LISTING, specs: [] })))
    renderPage()
    await screen.findByText('Royal Ashanti Lodge')
    expect(screen.getByText('No specs listed yet.')).toBeInTheDocument()
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
        avg_rating: 5, review_count: 1,
      })),
    )
    renderPage()
    await screen.findByText('Royal Ashanti Lodge')
    expect(await screen.findByText('Loved it, would stay again.')).toBeInTheDocument()
    expect(screen.getByText('Kwame')).toBeInTheDocument()
    expect(screen.getByText('(1 reviews)')).toBeInTheDocument()
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

describe('ListingDetailPage — Q&As tab', () => {
  it('lists each question with its answer, or "Not yet answered"', async () => {
    server.use(
      http.get('http://localhost:8000/api/listings/1/', () => HttpResponse.json(LISTING)),
      http.get('http://localhost:8000/api/qa/questions/listing/1/', () => HttpResponse.json({
        count: 2, next: null, previous: null,
        results: [
          { id: 1, question_text: 'Is breakfast included?', answer_text: 'Yes, complimentary breakfast is included.', answered_at: '2026-07-01T00:00:00Z' },
          { id: 2, question_text: 'Is parking available?', answer_text: null, answered_at: null },
        ],
      })),
    )
    renderPage()
    await screen.findByText('Royal Ashanti Lodge')
    expect(await screen.findByText('Q: Is breakfast included?')).toBeInTheDocument()
    expect(screen.getByText('A: Yes, complimentary breakfast is included.')).toBeInTheDocument()
    expect(screen.getByText('Q: Is parking available?')).toBeInTheDocument()
    expect(screen.getByText('Not yet answered')).toBeInTheDocument()
  })

  it('lets a signed-in customer ask a question, POSTing to /api/qa/questions/', async () => {
    let requestBody = null
    server.use(
      http.get('http://localhost:8000/api/listings/1/', () => HttpResponse.json(LISTING)),
      http.post('http://localhost:8000/api/qa/questions/', async ({ request }) => {
        requestBody = await request.json()
        return HttpResponse.json({ id: 9, question_text: requestBody.question_text, answer_text: null, answered_at: null }, { status: 201 })
      }),
    )
    renderPage({ user: { id: 1, fullName: 'Ama', accountType: 'customer' } })
    await screen.findByText('Royal Ashanti Lodge')
    fireEvent.change(screen.getByPlaceholderText('Ask a question about this listing…'), { target: { value: 'Do you allow pets?' } })
    fireEvent.click(screen.getByText('Ask a Question'))
    await waitFor(() => expect(requestBody).toEqual({ target_type: 'listing', target_id: 1, question_text: 'Do you allow pets?' }))
  })

  it('lets the listing owner answer an unanswered question inline', async () => {
    let answerBody = null
    server.use(
      http.get('http://localhost:8000/api/listings/1/', () => HttpResponse.json(LISTING)),
      http.get('http://localhost:8000/api/qa/questions/listing/1/', () => HttpResponse.json({
        count: 1, next: null, previous: null,
        results: [{ id: 3, question_text: 'Is parking available?', answer_text: null, answered_at: null }],
      })),
      http.post('http://localhost:8000/api/qa/questions/:id/answer/', async ({ request }) => {
        answerBody = await request.json()
        return HttpResponse.json({ id: 3, answer_text: answerBody.answer_text, answered_at: '2026-07-01T00:00:00Z' })
      }),
    )
    // item.business_owner.id === 9 on the LISTING fixture — signed in as that same id.
    renderPage({ user: { id: 9, fullName: 'Ama Boateng', accountType: 'business_owner' } })
    await screen.findByText('Royal Ashanti Lodge')
    fireEvent.click(await screen.findByText('Answer'))
    fireEvent.change(screen.getByPlaceholderText('Write your answer…'), { target: { value: 'Yes, free parking on site.' } })
    fireEvent.click(screen.getByText('Submit Answer'))
    await waitFor(() => expect(answerBody).toEqual({ answer_text: 'Yes, free parking on site.' }))
  })
})

describe('ListingDetailPage — Compare tab', () => {
  const RELATED = [
    { id: 2, name: 'Adum Guest House', category: LISTING.category, price_amount: '300.00', price_unit: '/night', avg_rating: 4, review_count: 5, zone: { name: 'Adum' } },
    { id: 3, name: 'Kejetia Inn', category: LISTING.category, price_amount: '250.00', price_unit: '/night', avg_rating: 3.5, review_count: 2, zone: { name: 'Kejetia' } },
    { id: 4, name: 'Suame Suites', category: LISTING.category, price_amount: '400.00', price_unit: '/night', avg_rating: 0, review_count: 0, zone: { name: 'Suame' } },
  ]

  it('prompts for a second selection, caps selection at two, then renders a comparison table', async () => {
    server.use(
      http.get('http://localhost:8000/api/listings/1/', () => HttpResponse.json(LISTING)),
      http.get('http://localhost:8000/api/listings/1/related/', () => HttpResponse.json(RELATED)),
    )
    renderPage()
    await screen.findByText('Royal Ashanti Lodge')
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

  it('shows the empty-policy state when no warranty policy has been published yet', async () => {
    server.use(http.get('http://localhost:8000/api/listings/1/', () => HttpResponse.json(LISTING)))
    renderPage()
    await screen.findByText('Royal Ashanti Lodge')
    expect(await screen.findByText('No policy has been published yet.')).toBeInTheDocument()
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
    expect(await screen.findByText('Sold by Ama Boateng')).toBeInTheDocument()
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
    fireEvent.click(await screen.findByText(/Sold by Ama Boateng/))
    expect(await screen.findByText('Great seller!')).toBeInTheDocument()
  })

  it('renders nothing when the listing has no business_owner', async () => {
    server.use(http.get('http://localhost:8000/api/listings/1/', () => HttpResponse.json({ ...LISTING, business_owner: null })))
    renderPage()
    await screen.findByText('Royal Ashanti Lodge')
    expect(screen.queryByText(/Sold by/)).not.toBeInTheDocument()
  })
})
