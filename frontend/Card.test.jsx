import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { Card } from './App.jsx'
import { server } from './mocks/server.js'

const REAL_SHAPED_LISTING = {
  id: 1,
  name: 'Royal Ashanti Lodge',
  description: 'Luxury rooms with kente-draped interiors.',
  category: { slug: 'hotels', icon: '🏨', label: 'Hotels', color: '#000080' },
  zone: { name: 'Manhyia' },
  price_amount: '450.00',
  price_unit: '/night',
  tag: 'Featured',
  contact_phone: '+233244000001',
  lat: '6.688500',
  lng: '-1.624400',
  main_photo: 'http://localhost:8000/media/listing_photos/main/lodge.jpg',
  photos: [],
  created_at: '2026-07-09T00:00:00Z',
  // Present on every real public listing since Phase 5's promote/boost
  // feature (docs/BUSINESS_EVENTS_ROADMAP.md) — ordering is entirely
  // server-side, Card itself renders nothing off this flag.
  is_promoted: false,
}

describe('Card with real API shape', () => {
  it('renders the listing name, price, and zone from the real shape', () => {
    render(
      <Card
        item={REAL_SHAPED_LISTING}
        accentColor="#000080"
        user={null}
        favourites={[]}
        onFavourite={vi.fn()}
        currency="GHS"
        onMessage={vi.fn()}
      />,
    )
    expect(screen.getByText('Royal Ashanti Lodge')).toBeInTheDocument()
    expect(screen.getByText(/450/)).toBeInTheDocument()
    expect(screen.getByText(/Manhyia/)).toBeInTheDocument()
  })

  it('renders the main_photo as an image when present', () => {
    render(
      <Card
        item={REAL_SHAPED_LISTING}
        accentColor="#000080"
        user={null}
        favourites={[]}
        onFavourite={vi.fn()}
        currency="GHS"
        onMessage={vi.fn()}
      />,
    )
    const img = screen.getByRole('img', { name: /Royal Ashanti Lodge/i })
    expect(img).toHaveAttribute('src', REAL_SHAPED_LISTING.main_photo)
  })

  it('calls onOpen with the listing id when the name is clicked', () => {
    const onOpen = vi.fn()
    render(
      <Card
        item={REAL_SHAPED_LISTING}
        accentColor="#000080"
        user={null}
        favourites={[]}
        onFavourite={vi.fn()}
        currency="GHS"
        onMessage={vi.fn()}
        onOpen={onOpen}
      />,
    )
    fireEvent.click(screen.getByText('Royal Ashanti Lodge'))
    expect(onOpen).toHaveBeenCalledWith(1)
  })

  it('does not call onOpen when the favourite button is clicked', () => {
    const onOpen = vi.fn()
    const onFavourite = vi.fn()
    render(
      <Card
        item={REAL_SHAPED_LISTING}
        accentColor="#000080"
        user={null}
        favourites={[]}
        onFavourite={onFavourite}
        currency="GHS"
        onMessage={vi.fn()}
        onOpen={onOpen}
      />,
    )
    fireEvent.click(screen.getByText('🤍'))
    expect(onFavourite).toHaveBeenCalledWith(1)
    expect(onOpen).not.toHaveBeenCalled()
  })
})

function renderCard(item, props = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <Card
        item={item}
        accentColor="#000080"
        user={null}
        favourites={[]}
        onFavourite={vi.fn()}
        currency="GHS"
        onMessage={vi.fn()}
        {...props}
      />
    </QueryClientProvider>,
  )
}

describe('Card rating display (Phase 4)', () => {
  it('shows stars/review count when avg_rating and review_count are present', () => {
    renderCard({ ...REAL_SHAPED_LISTING, avg_rating: 4.5, review_count: 12 })
    expect(screen.getByText('(12 reviews)')).toBeInTheDocument()
  })

  it('hides the rating row when review_count is 0', () => {
    renderCard({ ...REAL_SHAPED_LISTING, avg_rating: 0, review_count: 0 })
    expect(screen.queryByText(/reviews\)/)).not.toBeInTheDocument()
  })

  it('hides the rating row when avg_rating/review_count are absent altogether', () => {
    renderCard({ ...REAL_SHAPED_LISTING })
    expect(screen.queryByText(/reviews\)/)).not.toBeInTheDocument()
  })
})

describe('Card ReviewsModal (Phase 4 — real backend data)', () => {
  it('opens and shows real review data from GET /api/reviews/listing/:id/', async () => {
    server.use(
      http.get('http://localhost:8000/api/reviews/listing/1/', () =>
        HttpResponse.json({
          count: 1,
          next: null,
          previous: null,
          results: [
            { id: 1, target_type: 'listing', rating: 5, comment: 'Absolutely stunning hotel.', verified: true, author_name: 'Emma Thompson', created_at: '2026-05-28T00:00:00Z' },
          ],
          avg_rating: 5,
          review_count: 1,
        }),
      ),
    )
    renderCard({ ...REAL_SHAPED_LISTING, avg_rating: 5, review_count: 1 })
    fireEvent.click(screen.getByText('(1 reviews)'))
    expect(await screen.findByText('Absolutely stunning hotel.')).toBeInTheDocument()
    expect(screen.getByText('Emma Thompson')).toBeInTheDocument()
    expect(screen.getByText('✓ Verified Purchase')).toBeInTheDocument()
  })

  it('shows "sign in to leave a review" when signed out', async () => {
    renderCard({ ...REAL_SHAPED_LISTING, avg_rating: 5, review_count: 1 }, { user: null })
    fireEvent.click(screen.getByText('(1 reviews)'))
    expect(await screen.findByText('Sign in to leave a review')).toBeInTheDocument()
  })

  it('shows "you can review this after a completed purchase" when signed in but not eligible and not yet reviewed', async () => {
    server.use(
      http.get('http://localhost:8000/api/reviews/eligibility/', () =>
        HttpResponse.json({ eligible: false, already_reviewed: false }),
      ),
    )
    renderCard(
      { ...REAL_SHAPED_LISTING, avg_rating: 5, review_count: 1 },
      { user: { fullName: 'Ama Boateng', accountType: 'customer' } },
    )
    fireEvent.click(screen.getByText('(1 reviews)'))
    expect(await screen.findByText('You can review this after a completed purchase.')).toBeInTheDocument()
  })

  it('shows "you\'ve already reviewed this" when signed in and already reviewed', async () => {
    server.use(
      http.get('http://localhost:8000/api/reviews/eligibility/', () =>
        HttpResponse.json({ eligible: false, already_reviewed: true }),
      ),
    )
    renderCard(
      { ...REAL_SHAPED_LISTING, avg_rating: 5, review_count: 1 },
      { user: { fullName: 'Ama Boateng', accountType: 'customer' } },
    )
    fireEvent.click(screen.getByText('(1 reviews)'))
    expect(await screen.findByText("You've already reviewed this.")).toBeInTheDocument()
  })

  it('shows the write-review form when eligible, and submits POST /api/reviews/ with the right body', async () => {
    server.use(
      http.get('http://localhost:8000/api/reviews/eligibility/', () =>
        HttpResponse.json({ eligible: true, already_reviewed: false }),
      ),
    )
    let postedBody = null
    server.use(
      http.post('http://localhost:8000/api/reviews/', async ({ request }) => {
        postedBody = await request.json()
        return HttpResponse.json(
          { id: 2, rating: postedBody.rating, comment: postedBody.comment, verified: true, author_name: 'Ama Boateng', created_at: '2026-07-14T00:00:00Z' },
          { status: 201 },
        )
      }),
    )
    renderCard(
      { ...REAL_SHAPED_LISTING, avg_rating: 5, review_count: 1 },
      { user: { fullName: 'Ama Boateng', accountType: 'customer' } },
    )
    fireEvent.click(screen.getByText('(1 reviews)'))
    const textarea = await screen.findByPlaceholderText('Share your experience...')
    const stars = screen.getAllByText('★')
    fireEvent.click(stars[stars.length - 1]) // 5th (last) star picker icon
    fireEvent.change(textarea, { target: { value: 'Wonderful experience, highly recommend!' } })
    fireEvent.click(screen.getByText('Submit Review'))
    await waitFor(() => expect(postedBody).toEqual({
      target_type: 'listing',
      target_id: 1,
      rating: 5,
      comment: 'Wonderful experience, highly recommend!',
    }))
    expect(await screen.findByText('Review submitted! Thank you.')).toBeInTheDocument()
  })
})
