import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import EventCard, { formatEventDate } from './components/EventCard.jsx'

const PUBLIC_EVENT = {
  id: 1,
  name: 'Akwasidae Festival',
  category: { icon: '🥁', label: 'Festivals', color: '#CC0000' },
  zone: { name: 'Manhyia' },
  event_date: '2026-08-03T10:00:00Z',
  hero_media: 'http://localhost:8000/media/event_media/akwasidae.jpg',
  is_private: false,
}

const PRIVATE_EVENT = {
  ...PUBLIC_EVENT,
  id: 2,
  name: 'Private Wedding Reception',
  hero_media: 'http://localhost:8000/media/event_media/wedding.jpg',
  is_private: true,
}

describe('EventCard', () => {
  it('renders the event name, category and zone', () => {
    render(<EventCard item={PUBLIC_EVENT} onOpen={vi.fn()} />)
    expect(screen.getByText('Akwasidae Festival')).toBeInTheDocument()
    expect(screen.getByText(/Festivals/)).toBeInTheDocument()
    expect(screen.getByText(/Manhyia/)).toBeInTheDocument()
  })

  it('renders the hero_media photo for a public event', () => {
    render(<EventCard item={PUBLIC_EVENT} onOpen={vi.fn()} />)
    expect(screen.getByAltText('Akwasidae Festival')).toHaveAttribute('src', PUBLIC_EVENT.hero_media)
  })

  it('shows a lock placeholder instead of the photo for a private event', () => {
    render(<EventCard item={PRIVATE_EVENT} onOpen={vi.fn()} />)
    expect(screen.getByText('Private Event')).toBeInTheDocument()
    expect(screen.queryByAltText('Private Wedding Reception')).not.toBeInTheDocument()
    expect(screen.getByText('🔒 Code required')).toBeInTheDocument()
  })

  it('calls onOpen with the event id when clicked', () => {
    const onOpen = vi.fn()
    render(<EventCard item={PUBLIC_EVENT} onOpen={onOpen} />)
    fireEvent.click(screen.getByText('Akwasidae Festival'))
    expect(onOpen).toHaveBeenCalledWith(1)
  })
})

describe('EventCard rating display (Phase 4)', () => {
  it('shows stars/rating/review count when review_count > 0', () => {
    render(<EventCard item={{ ...PUBLIC_EVENT, avg_rating: 4.5, review_count: 8 }} onOpen={vi.fn()} />)
    expect(screen.getByText(/\(8 reviews\)/)).toBeInTheDocument()
    expect(screen.getByText(/4\.5/)).toBeInTheDocument()
  })

  it('hides the rating row when review_count is 0', () => {
    render(<EventCard item={{ ...PUBLIC_EVENT, avg_rating: 0, review_count: 0 }} onOpen={vi.fn()} />)
    expect(screen.queryByText(/reviews\)/)).not.toBeInTheDocument()
  })

  it('hides the rating row when avg_rating/review_count are absent altogether', () => {
    render(<EventCard item={PUBLIC_EVENT} onOpen={vi.fn()} />)
    expect(screen.queryByText(/reviews\)/)).not.toBeInTheDocument()
  })
})

describe('formatEventDate', () => {
  it('formats an ISO date string', () => {
    expect(formatEventDate('2026-08-03T10:00:00Z')).toMatch(/Aug/)
  })

  it('returns an empty string for a missing/invalid date', () => {
    expect(formatEventDate(null)).toBe('')
    expect(formatEventDate('not-a-date')).toBe('')
  })
})
