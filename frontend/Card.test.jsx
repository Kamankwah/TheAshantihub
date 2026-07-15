import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Card } from './App.jsx'

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
