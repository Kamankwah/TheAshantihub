import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from './mocks/server.js'
import HeroCarousel from './components/HeroCarousel.jsx'

function renderCarousel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <HeroCarousel />
    </QueryClientProvider>,
  )
}

const SLIDES = [
  { id: 1, media: 'http://localhost:8000/media/hero_media/one.jpg', media_type: 'image', caption: 'Best kente in Bonwire', business_name: 'Kente Palace Weavers', approved_at: '2026-07-01T00:00:00Z', expires_at: '2026-08-01T00:00:00Z' },
  { id: 2, media: 'http://localhost:8000/media/hero_media/two.jpg', media_type: 'image', caption: 'Fresh chop daily', business_name: "Afia's Kitchen", approved_at: '2026-07-02T00:00:00Z', expires_at: '2026-08-02T00:00:00Z' },
]

describe('HeroCarousel', () => {
  it('renders nothing when there are no active hero submissions', async () => {
    server.use(http.get('http://localhost:8000/api/hero/active/', () => HttpResponse.json([])))
    const { container } = renderCarousel()
    await new Promise((r) => setTimeout(r, 0))
    expect(container.firstChild).toBeNull()
  })

  it('renders the first slide caption as the headline once loaded', async () => {
    // The business name is intentionally NOT shown in the hero (the caption is
    // the big marketable headline instead).
    server.use(http.get('http://localhost:8000/api/hero/active/', () => HttpResponse.json(SLIDES)))
    renderCarousel()
    expect(await screen.findByText('Best kente in Bonwire')).toBeInTheDocument()
    expect(screen.queryByText('Kente Palace Weavers')).not.toBeInTheDocument()
  })

  it('advances to the next slide when the next control is clicked', async () => {
    server.use(http.get('http://localhost:8000/api/hero/active/', () => HttpResponse.json(SLIDES)))
    renderCarousel()
    await screen.findByText('Best kente in Bonwire')
    fireEvent.click(screen.getByLabelText('Next slide'))
    expect(screen.getByText('Fresh chop daily')).toBeInTheDocument()
  })

  it('renders dot controls matching the slide count', async () => {
    server.use(http.get('http://localhost:8000/api/hero/active/', () => HttpResponse.json(SLIDES)))
    renderCarousel()
    await screen.findByText('Best kente in Bonwire')
    expect(screen.getByLabelText('Go to slide 1')).toBeInTheDocument()
    expect(screen.getByLabelText('Go to slide 2')).toBeInTheDocument()
  })

  it('does not render prev/next/dot controls for a single slide', async () => {
    server.use(http.get('http://localhost:8000/api/hero/active/', () => HttpResponse.json([SLIDES[0]])))
    renderCarousel()
    await screen.findByText('Best kente in Bonwire')
    expect(screen.queryByLabelText('Next slide')).not.toBeInTheDocument()
  })
})
