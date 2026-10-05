import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import OwnerListingCard from './OwnerListingCard.jsx'

const LISTING = {
  id: 1, name: 'Handwoven kente stole', price_amount: '250.00', stock_quantity: 11,
  status: 'published', photos: [],
}

describe('OwnerListingCard photos', () => {
  it('shows the main photo and no empty-state when the listing only has a main photo', () => {
    render(<OwnerListingCard listing={{ ...LISTING, main_photo: 'https://cdn.test/stole.jpg' }} onChanged={() => {}} />)
    expect(screen.getByAltText('Main photo')).toHaveAttribute('src', 'https://cdn.test/stole.jpg')
    expect(screen.queryByText(/No photos yet/)).not.toBeInTheDocument()
  })

  it('shows the empty-state when there is no main photo and no gallery photos', () => {
    render(<OwnerListingCard listing={{ ...LISTING, main_photo: null }} onChanged={() => {}} />)
    expect(screen.getByText(/No photos yet/)).toBeInTheDocument()
  })
})
