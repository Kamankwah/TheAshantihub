import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { server } from './mocks/server.js'
import EventHeroCarousel from './components/EventHeroCarousel.jsx'

function renderCarousel(props = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <EventHeroCarousel {...props} />
    </QueryClientProvider>,
  )
}

const EVENTS_PAGE = {
  count: 3,
  next: null,
  previous: null,
  results: [
    { id: 1, name: 'Akwasidae Festival', category: { icon: '🥁', label: 'Festivals' }, zone: { name: 'Manhyia' }, event_date: '2026-08-03T10:00:00Z', hero_media: 'http://localhost:8000/media/event_media/one.jpg', is_private: false },
    { id: 2, name: 'Kumasi Cultural Festival', category: { icon: '🎭', label: 'Festivals' }, zone: { name: 'Adum' }, event_date: '2026-09-15T10:00:00Z', hero_media: 'http://localhost:8000/media/event_media/two.jpg', is_private: false },
    { id: 3, name: 'No Photo Market Day', category: { icon: '🛍️', label: 'Markets' }, zone: { name: 'Kejetia' }, event_date: '2026-09-20T10:00:00Z', hero_media: null, is_private: false },
  ],
}

describe('EventHeroCarousel', () => {
  it('renders nothing when there are no events with hero_media', async () => {
    server.use(http.get('http://localhost:8000/api/events/', () => HttpResponse.json({ count: 1, next: null, previous: null, results: [EVENTS_PAGE.results[2]] })))
    const { container } = renderCarousel()
    await new Promise((r) => setTimeout(r, 0))
    expect(container.firstChild).toBeNull()
  })

  it('renders only events that have hero_media set', async () => {
    server.use(http.get('http://localhost:8000/api/events/', () => HttpResponse.json(EVENTS_PAGE)))
    renderCarousel()
    expect(await screen.findByText(/Akwasidae Festival/)).toBeInTheDocument()
    expect(screen.queryByText(/No Photo Market Day/)).not.toBeInTheDocument()
  })

  it('advances to the next slide when the next control is clicked', async () => {
    server.use(http.get('http://localhost:8000/api/events/', () => HttpResponse.json(EVENTS_PAGE)))
    renderCarousel()
    await screen.findByText(/Akwasidae Festival/)
    fireEvent.click(screen.getByLabelText('Next slide'))
    expect(screen.getByText(/Kumasi Cultural Festival/)).toBeInTheDocument()
  })

  it('calls onOpen with the event id when a slide is clicked', async () => {
    server.use(http.get('http://localhost:8000/api/events/', () => HttpResponse.json(EVENTS_PAGE)))
    const onOpen = vi.fn()
    renderCarousel({ onOpen })
    await screen.findByText(/Akwasidae Festival/)
    fireEvent.click(screen.getByText(/Akwasidae Festival/))
    expect(onOpen).toHaveBeenCalledWith(1)
  })

  it('shows a private-event badge for a private event slide', async () => {
    server.use(
      http.get('http://localhost:8000/api/events/', () =>
        HttpResponse.json({ count: 1, next: null, previous: null, results: [{ ...EVENTS_PAGE.results[0], is_private: true }] }),
      ),
    )
    renderCarousel()
    expect(await screen.findByText('🔒 Private Event')).toBeInTheDocument()
  })
})
