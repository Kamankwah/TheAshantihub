import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { server } from './mocks/server.js'
import EventDetailPage from './components/EventDetailPage.jsx'

function renderPage(props = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <EventDetailPage id={1} onBack={vi.fn()} {...props} />
    </QueryClientProvider>,
  )
}

const PUBLIC_DETAIL = {
  id: 1,
  name: 'Akwasidae Festival',
  description: 'The Asantehene receives homage — drumming, dancing and royal regalia.',
  category: { icon: '🥁', label: 'Festivals', color: '#CC0000' },
  zone: { name: 'Manhyia' },
  address: 'Manhyia Palace, Kumasi',
  lat: '6.6980',
  lng: '-1.6120',
  event_date: '2026-08-03T10:00:00Z',
  going_count: 42,
  access_level: 'public',
  media: [
    { id: 1, media: 'http://localhost:8000/media/event_media/one.jpg', media_type: 'image', order: 0 },
    { id: 2, media: 'http://localhost:8000/media/event_media/two.jpg', media_type: 'image', order: 1 },
  ],
  // Reviews/ratings/Q&A plan, Phase 2/6 — real fields on
  // GET /api/events/{id}/ as of that plan's Phase 2.
  avg_rating: 4,
  review_count: 3,
  organizer: { kind: 'business', id: 9, full_name: 'Manhyia Palace Events Ltd' },
}

// Teaser shape — what a private, locked event's detail endpoint returns
// (EventTeaserSerializer's field list has no "address" key at all).
const PRIVATE_TEASER = {
  id: 2,
  name: 'Private Wedding Reception',
  category: { icon: '💍', label: 'Weddings', color: '#B8860B' },
  zone: { name: 'Adum' },
  event_date: '2026-09-01T18:00:00Z',
  hero_media: null,
  is_private: true,
}

describe('EventDetailPage — full detail (public event)', () => {
  it('renders name, description, address, event date and going_count', async () => {
    server.use(http.get('http://localhost:8000/api/events/1/', () => HttpResponse.json(PUBLIC_DETAIL)))
    renderPage()
    expect(await screen.findByText('Akwasidae Festival')).toBeInTheDocument()
    expect(screen.getByText(/drumming, dancing/)).toBeInTheDocument()
    expect(screen.getByText(/Manhyia Palace, Kumasi/)).toBeInTheDocument()
    expect(screen.getByText(/42 going/)).toBeInTheDocument()
  })

  it('renders a "Get Directions" link when lat/lng are present', async () => {
    server.use(http.get('http://localhost:8000/api/events/1/', () => HttpResponse.json(PUBLIC_DETAIL)))
    renderPage()
    await screen.findByText('Akwasidae Festival')
    const link = screen.getByText('🧭 Get Directions')
    expect(link.closest('a')).toHaveAttribute('href', `https://www.google.com/maps?q=${PUBLIC_DETAIL.lat},${PUBLIC_DETAIL.lng}`)
  })

  it('does not render "Get Directions" when lat/lng are absent', async () => {
    server.use(http.get('http://localhost:8000/api/events/1/', () => HttpResponse.json({ ...PUBLIC_DETAIL, lat: null, lng: null })))
    renderPage()
    await screen.findByText('Akwasidae Festival')
    expect(screen.queryByText('🧭 Get Directions')).not.toBeInTheDocument()
  })

  it('renders a media gallery thumbnail per photo', async () => {
    server.use(http.get('http://localhost:8000/api/events/1/', () => HttpResponse.json(PUBLIC_DETAIL)))
    renderPage()
    await screen.findByText('Akwasidae Festival')
    expect(screen.getByLabelText('View photo 1')).toBeInTheDocument()
    expect(screen.getByLabelText('View photo 2')).toBeInTheDocument()
  })

  it('calls onBack when the back button is clicked', async () => {
    server.use(http.get('http://localhost:8000/api/events/1/', () => HttpResponse.json(PUBLIC_DETAIL)))
    const onBack = vi.fn()
    renderPage({ onBack })
    await screen.findByText('Akwasidae Festival')
    fireEvent.click(screen.getByText('‹ Back to events'))
    expect(onBack).toHaveBeenCalled()
  })

  it('shows a retry option on error', async () => {
    server.use(http.get('http://localhost:8000/api/events/1/', () => new HttpResponse(null, { status: 500 })))
    renderPage()
    expect(await screen.findByText('Could not load this event.')).toBeInTheDocument()
  })
})

const CUSTOMER = { accountType: 'customer', fullName: 'Ama Owusu', id: 101 };
const BUSINESS_OWNER = { accountType: 'business_owner', fullName: 'Kwame Biz' };

describe('EventDetailPage — RSVP role gating', () => {
  it('shows a sign-in prompt and no toggle when signed out', async () => {
    server.use(http.get('http://localhost:8000/api/events/1/', () => HttpResponse.json(PUBLIC_DETAIL)))
    renderPage()
    await screen.findByText('Akwasidae Festival')
    expect(screen.getByText('Sign in to RSVP to this event.')).toBeInTheDocument()
    expect(screen.queryByText("🎉 I'm Going")).not.toBeInTheDocument()
  })

  it('shows a disabled toggle with an explanatory note for business-owner accounts', async () => {
    server.use(http.get('http://localhost:8000/api/events/1/', () => HttpResponse.json(PUBLIC_DETAIL)))
    renderPage({ user: BUSINESS_OWNER })
    await screen.findByText('Akwasidae Festival')
    expect(screen.getByText("🎉 I'm Going")).toBeDisabled()
    expect(screen.getByText(/RSVPs are for customer accounts/)).toBeInTheDocument()
  })

  it('shows a live toggle for a signed-in customer', async () => {
    server.use(http.get('http://localhost:8000/api/events/1/', () => HttpResponse.json(PUBLIC_DETAIL)))
    renderPage({ user: CUSTOMER })
    await screen.findByText('Akwasidae Festival')
    expect(screen.getByText("🎉 I'm Going")).not.toBeDisabled()
  })
})

describe('EventDetailPage — RSVP state resets when the signed-in account changes', () => {
  it('does not leak one account\'s optimistic "going" status to a different account signing in without a remount', async () => {
    // Regression test: this app has no router, so switching accounts while
    // the same event stays open (AshantiHub's selectedEventId is untouched
    // by auth state) does not necessarily remount EventDetailPage. Without
    // resetting local RSVP state on `user?.id` change, the previous
    // account's "going" status stayed visible to the next signed-in
    // account — found via manual browser verification (sign in as customer
    // A, RSVP, sign out, sign in as customer B without a page reload: B saw
    // "✓ Going — Can't Go?" despite never having RSVP'd).
    server.use(
      http.get('http://localhost:8000/api/events/1/', () => HttpResponse.json(PUBLIC_DETAIL)),
      http.post('http://localhost:8000/api/events/1/rsvp/', () => HttpResponse.json({ event: 1, status: 'going', going_count: 43 }, { status: 201 })),
    )
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <EventDetailPage id={1} onBack={vi.fn()} user={CUSTOMER} />
      </QueryClientProvider>,
    )
    await screen.findByText('Akwasidae Festival')
    fireEvent.click(screen.getByText("🎉 I'm Going"))
    expect(await screen.findByText("✓ Going — Can't Go?")).toBeInTheDocument()

    const OTHER_CUSTOMER = { accountType: 'customer', fullName: 'Kojo Mensah', id: 202 }
    rerender(
      <QueryClientProvider client={queryClient}>
        <EventDetailPage id={1} onBack={vi.fn()} user={OTHER_CUSTOMER} />
      </QueryClientProvider>,
    )
    expect(await screen.findByText("🎉 I'm Going")).toBeInTheDocument()
    expect(screen.queryByText("✓ Going — Can't Go?")).not.toBeInTheDocument()
  })
})

describe('EventDetailPage — RSVP toggle (public event, signed-in customer)', () => {
  it('RSVPs "going" via POST and updates the live going_count badge', async () => {
    server.use(
      http.get('http://localhost:8000/api/events/1/', () => HttpResponse.json(PUBLIC_DETAIL)),
      http.post('http://localhost:8000/api/events/1/rsvp/', async ({ request }) => {
        const body = await request.json()
        expect(body).toEqual({})
        return HttpResponse.json({ event: 1, status: 'going', going_count: 43 }, { status: 201 })
      }),
    )
    renderPage({ user: CUSTOMER })
    await screen.findByText('Akwasidae Festival')
    expect(screen.getByText(/42 going/)).toBeInTheDocument()
    fireEvent.click(screen.getByText("🎉 I'm Going"))
    expect(await screen.findByText("✓ Going — Can't Go?")).toBeInTheDocument()
    expect(await screen.findByText(/43 going/)).toBeInTheDocument()
  })

  it('cancels a "going" RSVP via DELETE and decrements the going_count badge', async () => {
    server.use(
      http.get('http://localhost:8000/api/events/1/', () => HttpResponse.json(PUBLIC_DETAIL)),
      http.post('http://localhost:8000/api/events/1/rsvp/', () => HttpResponse.json({ event: 1, status: 'going', going_count: 43 }, { status: 201 })),
      http.delete('http://localhost:8000/api/events/1/rsvp/', () => new HttpResponse(null, { status: 204 })),
    )
    renderPage({ user: CUSTOMER })
    await screen.findByText('Akwasidae Festival')
    fireEvent.click(screen.getByText("🎉 I'm Going"))
    await screen.findByText("✓ Going — Can't Go?")
    fireEvent.click(screen.getByText("✓ Going — Can't Go?"))
    expect(await screen.findByText("🎉 I'm Going")).toBeInTheDocument()
    expect(await screen.findByText(/42 going/)).toBeInTheDocument()
  })

  it('shows a capacity-full state (not the toggle) on a 400 "at capacity" response', async () => {
    server.use(
      http.get('http://localhost:8000/api/events/1/', () => HttpResponse.json(PUBLIC_DETAIL)),
      http.post('http://localhost:8000/api/events/1/rsvp/', () => HttpResponse.json({ detail: 'This event is at capacity.' }, { status: 400 })),
    )
    renderPage({ user: CUSTOMER })
    await screen.findByText('Akwasidae Festival')
    fireEvent.click(screen.getByText("🎉 I'm Going"))
    expect(await screen.findByText('🚫 This event is at capacity.')).toBeInTheDocument()
    expect(screen.queryByText("🎉 I'm Going")).not.toBeInTheDocument()
  })

  it('shows a generic error (not the capacity state) on an unrelated failure', async () => {
    server.use(
      http.get('http://localhost:8000/api/events/1/', () => HttpResponse.json(PUBLIC_DETAIL)),
      http.post('http://localhost:8000/api/events/1/rsvp/', () => new HttpResponse(null, { status: 500 })),
    )
    renderPage({ user: CUSTOMER })
    await screen.findByText('Akwasidae Festival')
    fireEvent.click(screen.getByText("🎉 I'm Going"))
    expect(await screen.findByText('Could not RSVP to this event right now. Please try again.')).toBeInTheDocument()
    expect(screen.queryByText('🚫 This event is at capacity.')).not.toBeInTheDocument()
  })
})

describe('EventDetailPage — RSVP on a private event reuses the already-entered unlock code', () => {
  it('sends the unlock code on the RSVP POST body without prompting for it again', async () => {
    server.use(
      http.get('http://localhost:8000/api/events/2/', () => HttpResponse.json(PRIVATE_TEASER)),
      http.post('http://localhost:8000/api/events/2/unlock/', async ({ request }) => {
        const body = await request.json()
        if (body.code !== 'SECRET1') return new HttpResponse(JSON.stringify({ detail: 'Invalid access code.' }), { status: 403 })
        return HttpResponse.json({ ...PUBLIC_DETAIL, id: 2, name: 'Private Wedding Reception', access_level: 'private' })
      }),
      http.post('http://localhost:8000/api/events/2/rsvp/', async ({ request }) => {
        const body = await request.json()
        expect(body).toEqual({ code: 'SECRET1' })
        return HttpResponse.json({ event: 2, status: 'going', going_count: 5 }, { status: 201 })
      }),
    )
    renderPage({ id: 2, user: CUSTOMER })
    await screen.findByText('This event is private — enter the code to view details.')
    fireEvent.change(screen.getByLabelText('Access code'), { target: { value: 'SECRET1' } })
    fireEvent.click(screen.getByText('Unlock'))
    await screen.findByText(/drumming, dancing/)
    expect(screen.queryByLabelText('Access code')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText("🎉 I'm Going"))
    expect(await screen.findByText("✓ Going — Can't Go?")).toBeInTheDocument()
  })
})

describe('EventDetailPage — Reviews section (reviews/ratings/Q&A plan, Phase 6)', () => {
  it('shows the review aggregate and the review list', async () => {
    server.use(
      http.get('http://localhost:8000/api/events/1/', () => HttpResponse.json(PUBLIC_DETAIL)),
      http.get('http://localhost:8000/api/reviews/event/1/', () => HttpResponse.json({
        count: 1, next: null, previous: null,
        results: [{ id: 5, author_name: 'Yaw', rating: 4, comment: 'Great festival atmosphere.', verified: true, created_at: '2026-07-01T00:00:00Z' }],
        avg_rating: 4, review_count: 1,
      })),
    )
    renderPage()
    await screen.findByText('Akwasidae Festival')
    expect(await screen.findByText('Great festival atmosphere.')).toBeInTheDocument()
    expect(screen.getByText('Yaw')).toBeInTheDocument()
    expect(screen.getByText('(1 reviews)')).toBeInTheDocument()
  })

  it('prompts a signed-out visitor to sign in before writing a review', async () => {
    server.use(http.get('http://localhost:8000/api/events/1/', () => HttpResponse.json(PUBLIC_DETAIL)))
    renderPage({ user: null })
    await screen.findByText('Akwasidae Festival')
    expect(await screen.findByText('Sign in to leave a review')).toBeInTheDocument()
  })

  it('shows the write form for an eligible signed-in customer (a verified attendee)', async () => {
    server.use(
      http.get('http://localhost:8000/api/events/1/', () => HttpResponse.json(PUBLIC_DETAIL)),
      http.get('http://localhost:8000/api/reviews/eligibility/', () => HttpResponse.json({ eligible: true, already_reviewed: false })),
    )
    renderPage({ user: CUSTOMER })
    await screen.findByText('Akwasidae Festival')
    expect(await screen.findByPlaceholderText('Share your experience...')).toBeInTheDocument()
  })
})

describe('EventDetailPage — Organizer section (reviews/ratings/Q&A plan, Phase 6)', () => {
  it('renders "Organized by {full_name}" with no fabricated rating when the organizer has no reviews yet', async () => {
    server.use(http.get('http://localhost:8000/api/events/1/', () => HttpResponse.json(PUBLIC_DETAIL)))
    renderPage()
    await screen.findByText('Akwasidae Festival')
    expect(await screen.findByText('Organized by Manhyia Palace Events Ltd')).toBeInTheDocument()
  })

  it('shows the organizer rating when the organizer has reviews', async () => {
    server.use(
      http.get('http://localhost:8000/api/events/1/', () => HttpResponse.json(PUBLIC_DETAIL)),
      http.get('http://localhost:8000/api/reviews/organizer/business/9/', () => HttpResponse.json({
        count: 1, next: null, previous: null,
        results: [{ id: 8, author_name: 'Abena', rating: 5, comment: 'Wonderful organizer!', verified: true, created_at: '2026-07-01T00:00:00Z' }],
        avg_rating: 4.7, review_count: 12,
      })),
    )
    renderPage()
    await screen.findByText('Akwasidae Festival')
    expect(await screen.findByText(/⭐ 4.7 · Organized by Manhyia Palace Events Ltd · 12 organizer reviews/)).toBeInTheDocument()
  })

  it('expands to show the organizer review list and write form when clicked', async () => {
    server.use(
      http.get('http://localhost:8000/api/events/1/', () => HttpResponse.json(PUBLIC_DETAIL)),
      http.get('http://localhost:8000/api/reviews/organizer/business/9/', () => HttpResponse.json({
        count: 1, next: null, previous: null,
        results: [{ id: 8, author_name: 'Abena', rating: 5, comment: 'Wonderful organizer!', verified: true, created_at: '2026-07-01T00:00:00Z' }],
        avg_rating: 4.7, review_count: 1,
      })),
    )
    renderPage()
    await screen.findByText('Akwasidae Festival')
    fireEvent.click(await screen.findByText(/Organized by Manhyia Palace Events Ltd/))
    expect(await screen.findByText('Wonderful organizer!')).toBeInTheDocument()
    expect(screen.getByText('✍️ Write an Organizer Review')).toBeInTheDocument()
  })

  it('renders nothing when the event has no organizer field', async () => {
    const { organizer, ...withoutOrganizer } = PUBLIC_DETAIL
    server.use(http.get('http://localhost:8000/api/events/1/', () => HttpResponse.json(withoutOrganizer)))
    renderPage()
    await screen.findByText('Akwasidae Festival')
    expect(screen.queryByText(/Organized by/)).not.toBeInTheDocument()
  })
})

describe('EventDetailPage — Reviews/Organizer sections are unreachable on a locked event (regression guard)', () => {
  it('never renders the Reviews or Organizer sections while the event stays locked', async () => {
    server.use(http.get('http://localhost:8000/api/events/2/', () => HttpResponse.json(PRIVATE_TEASER)))
    renderPage({ id: 2 })
    await screen.findByText('This event is private — enter the code to view details.')
    expect(screen.queryByText('Reviews')).not.toBeInTheDocument()
    expect(screen.queryByText(/Organized by/)).not.toBeInTheDocument()
    expect(screen.queryByText('Sign in to leave a review')).not.toBeInTheDocument()
  })
})

describe('EventDetailPage — locked (private, un-unlocked) event', () => {
  it('renders the locked prompt instead of description/address/directions when the response is a teaser', async () => {
    server.use(http.get('http://localhost:8000/api/events/2/', () => HttpResponse.json(PRIVATE_TEASER)))
    renderPage({ id: 2 })
    expect(await screen.findByText('This event is private — enter the code to view details.')).toBeInTheDocument()
    expect(screen.getByText('Private Wedding Reception')).toBeInTheDocument()
    expect(screen.queryByText('🧭 Get Directions')).not.toBeInTheDocument()
    expect(screen.queryByText(/going/)).not.toBeInTheDocument()
  })

  it('unlocks and renders full detail on a correct code, via the unlock endpoint', async () => {
    server.use(
      http.get('http://localhost:8000/api/events/2/', () => HttpResponse.json(PRIVATE_TEASER)),
      http.post('http://localhost:8000/api/events/2/unlock/', async ({ request }) => {
        const body = await request.json()
        if (body.code !== 'SECRET1') return new HttpResponse(JSON.stringify({ detail: 'Invalid access code.' }), { status: 403 })
        return HttpResponse.json({ ...PUBLIC_DETAIL, id: 2, name: 'Private Wedding Reception', access_level: 'private' })
      }),
    )
    renderPage({ id: 2 })
    await screen.findByText('This event is private — enter the code to view details.')
    fireEvent.change(screen.getByLabelText('Access code'), { target: { value: 'SECRET1' } })
    fireEvent.click(screen.getByText('Unlock'))
    expect(await screen.findByText(/drumming, dancing/)).toBeInTheDocument()
    expect(screen.getByText('🔒 Private Event — unlocked')).toBeInTheDocument()
  })

  it('shows an error and stays locked on an incorrect code', async () => {
    server.use(
      http.get('http://localhost:8000/api/events/2/', () => HttpResponse.json(PRIVATE_TEASER)),
      http.post('http://localhost:8000/api/events/2/unlock/', () => new HttpResponse(JSON.stringify({ detail: 'Invalid access code.' }), { status: 403 })),
    )
    renderPage({ id: 2 })
    await screen.findByText('This event is private — enter the code to view details.')
    fireEvent.change(screen.getByLabelText('Access code'), { target: { value: 'WRONG' } })
    fireEvent.click(screen.getByText('Unlock'))
    expect(await screen.findByText('Incorrect code. Please check it and try again.')).toBeInTheDocument()
    expect(screen.getByText('This event is private — enter the code to view details.')).toBeInTheDocument()
  })
})
