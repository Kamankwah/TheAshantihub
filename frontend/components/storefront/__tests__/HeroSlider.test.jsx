import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { server } from '../../../mocks/server.js'
import { HERO_SLIDES, HERO_URL, json } from '../../../mocks/storefront.js'
import HeroSlider from '../HeroSlider.jsx'

function renderWithClient(ui) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

const realMatchMedia = window.matchMedia
function prefersReducedMotion(reduced) {
  window.matchMedia = (query) => ({
    matches: reduced && query.includes('prefers-reduced-motion'),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })
}
afterEach(() => { window.matchMedia = realMatchMedia })

const IMAGES = [
  { ...HERO_SLIDES[0] },
  { ...HERO_SLIDES[0], id: 9, image: 'https://cdn.test/adum.jpg', title: 'Adum market', link_path: null, listing_id: null },
]

describe('HeroSlider', () => {
  it('renders_image_video_and_youtube_slides', async () => {
    server.use(json(HERO_URL, HERO_SLIDES))
    const onNavigate = vi.fn()
    const { container } = renderWithClient(<HeroSlider onNavigate={onNavigate} autoplayMs={0} />)
    const image = await screen.findByRole('img', { name: 'Kente week' })
    expect(image).toHaveAttribute('src', 'https://cdn.test/kente.jpg')
    fireEvent.click(screen.getByRole('button', { name: 'Kente week' }))
    expect(onNavigate).toHaveBeenCalledWith('/business/7')

    fireEvent.click(screen.getByRole('button', { name: 'Next slide' }))
    const video = container.querySelector('video')
    expect(video).toHaveAttribute('src', 'https://cdn.test/market.mp4')
    expect(video).toHaveAttribute('controls')
    expect(video.muted).toBe(true)
    expect(video).toHaveAttribute('playsinline')

    fireEvent.click(screen.getByRole('button', { name: 'Show slide 3 of 3' }))
    const frame = container.querySelector('iframe')
    expect(frame).toHaveAttribute('src', 'https://www.youtube-nocookie.com/embed/abc123XYZ00')
    expect(frame).toHaveAttribute('title', 'Festival film')
  })

  it('hidden_when_no_slides', async () => {
    let asked = false
    server.use(json(HERO_URL, []))
    server.events.on('request:start', () => { asked = true })
    const { container } = renderWithClient(<HeroSlider onNavigate={() => {}} />)
    await waitFor(() => expect(asked).toBe(true))
    await new Promise((r) => setTimeout(r, 50))
    expect(container).toBeEmptyDOMElement()
    server.events.removeAllListeners()
  })

  it('autoplays images when motion is allowed', async () => {
    prefersReducedMotion(false)
    server.use(json(HERO_URL, IMAGES))
    renderWithClient(<HeroSlider onNavigate={() => {}} autoplayMs={60} />)
    await screen.findByRole('img', { name: 'Kente week' })
    expect(await screen.findByRole('img', { name: 'Adum market' })).toBeInTheDocument()
  })

  it('no_autoplay_with_reduced_motion', async () => {
    prefersReducedMotion(true)
    server.use(json(HERO_URL, IMAGES))
    renderWithClient(<HeroSlider onNavigate={() => {}} autoplayMs={60} />)
    await screen.findByRole('img', { name: 'Kente week' })
    await new Promise((r) => setTimeout(r, 250))
    expect(screen.getByRole('img', { name: 'Kente week' })).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: 'Adum market' })).not.toBeInTheDocument()
  })
})
