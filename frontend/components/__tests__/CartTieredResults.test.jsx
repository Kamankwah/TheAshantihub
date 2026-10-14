import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import CartTieredResults from '../CartTieredResults.jsx'

const row = (id, name, over) => ({ id, name, cart_tier: 3, cart_label: null, cart_blocked: null, ...over })
const LISTINGS = [
  row(1, 'Kente stole', { cart_tier: 1, cart_label: 'In your cart' }),
  row(2, 'Beads', { cart_tier: 2, cart_label: '1.2 km from Kente House' }),
  row(3, 'Sandals', { cart_tier: 3 }),
  row(4, 'City tour', { cart_tier: null }),
  row(5, 'Bag', { cart_tier: 2, cart_label: '2.6 km from Kente House (estimate)', cart_blocked: { detail: 'Your delivery can include up to 4 shops. Remove one to add this.', code: 'shop_limit' } }),
]
const renderCard = (item) => <div>{item.name}</div>

describe('CartTieredResults', () => {
  it('puts cart shops first, then near shops with their distance, and services on their own', () => {
    render(<CartTieredResults listings={LISTINGS} renderCard={renderCard} />)
    const cart = screen.getByRole('region', { name: 'From shops in your cart' })
    expect(within(cart).getByText('Kente stole')).toBeInTheDocument()
    expect(within(cart).getByText('In your cart')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Near the shops in your cart' })).getByText('1.2 km from Kente House')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Services and stays' })).getByText('City tour')).toBeInTheDocument()
  })

  it('keeps everyone else behind "See other shops too"', () => {
    render(<CartTieredResults listings={LISTINGS} renderCard={renderCard} />)
    expect(screen.queryByText('Sandals')).not.toBeInTheDocument()
    const toggle = screen.getByRole('button', { name: 'See other shops too (1)' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(toggle)
    expect(screen.getByText('Sandals')).toBeInTheDocument()
  })

  it('shows "Delivery limit reached" and the reason instead of hiding the shop', () => {
    render(<CartTieredResults listings={LISTINGS} renderCard={renderCard} />)
    const note = screen.getByRole('note')
    expect(note).toHaveTextContent('Delivery limit reached')
    expect(note).toHaveTextContent('up to 4 shops')
    expect(screen.getByText('Bag')).toBeInTheDocument()
  })

  it('always offers the expander, and says so when nothing else is loaded', () => {
    render(<CartTieredResults listings={LISTINGS.slice(0, 1)} renderCard={renderCard} />)
    fireEvent.click(screen.getByRole('button', { name: 'See other shops too' }))
    expect(screen.getByText('No other shops in these results.')).toBeInTheDocument()
  })
})
