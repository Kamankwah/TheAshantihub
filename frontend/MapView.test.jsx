import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MapView } from './App.jsx'

const REAL_SHAPED_LISTINGS = [
  {
    id: 1, name: 'Royal Ashanti Lodge', lat: '6.688500', lng: '-1.624400',
    category: { slug: 'hotels', icon: '🏨', label: 'Hotels', color: '#000080' },
    zone: { name: 'Manhyia' },
  },
  {
    id: 2, name: 'No Coordinates Cafe', lat: null, lng: null,
    category: { slug: 'food', icon: '🍲', label: 'Food', color: '#CC0000' },
    zone: { name: 'Adum' },
  },
]

describe('MapView with real API shape', () => {
  it('renders a pin for each listing that has coordinates', () => {
    render(<MapView listings={REAL_SHAPED_LISTINGS} />)
    expect(screen.getByText('Royal Ashanti Lodge')).toBeInTheDocument()
    expect(screen.queryByText('No Coordinates Cafe')).not.toBeInTheDocument()
  })
})
