import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { server } from './mocks/server.js'
import ListingDetailPage from './components/ListingDetailPage.jsx'

const LISTING = {
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
  photos: [
    { id: 1, image: 'http://localhost:8000/media/listing_photos/gallery/1.jpg', order: 0 },
    { id: 2, image: 'http://localhost:8000/media/listing_photos/gallery/2.jpg', order: 1 },
  ],
  created_at: '2026-07-09T00:00:00Z',
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
        onWhatsApp={vi.fn()}
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
    await waitFor(() => expect(screen.getByText('Adum Guest House')).toBeInTheDocument())
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
    await waitFor(() => expect(screen.getByText('Adum Guest House')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Adum Guest House'))
    expect(onOpenListing).toHaveBeenCalledWith(2)
  })

  it('shows a retry option on error', async () => {
    server.use(http.get('http://localhost:8000/api/listings/1/', () => new HttpResponse(null, { status: 500 })))
    renderPage()
    expect(await screen.findByText('Could not load this listing.')).toBeInTheDocument()
  })
})
