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
