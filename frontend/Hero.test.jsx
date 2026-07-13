import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import Hero from './components/Hero.jsx'

const T = {
  welcome: 'Discover Kumasi — All in One Place',
  tagline: 'Hotels, tours, food, crafts, transport & more — The Marketplace of Ashanti.',
  signup: 'Create Free Account',
  login: 'Sign In',
  search: 'Search businesses...',
}

const PHOTOS = {
  manhyiaPalace: 'https://example.com/manhyia.jpg',
  kejetiaMarket: 'https://example.com/kejetia.jpg',
  akwasidae: 'https://example.com/akwasidae.jpg',
}

function renderHero(props = {}) {
  return render(
    <Hero
      T={T}
      user={null}
      setAuthModal={vi.fn()}
      setShowReferral={vi.fn()}
      searchInput=""
      setSearchInput={vi.fn()}
      showSearchResults={false}
      setShowSearchResults={vi.fn()}
      searchFocused={false}
      setSearchFocused={vi.fn()}
      setFilters={vi.fn()}
      setShowFilters={vi.fn()}
      showMap={false}
      setShowMap={vi.fn()}
      setShowFavs={vi.fn()}
      favourites={[]}
      photos={PHOTOS}
      {...props}
    />,
  )
}

describe('Hero', () => {
  it('renders the welcome heading, tagline and search input', () => {
    renderHero()
    expect(screen.getByText(/Discover Kumasi/)).toBeInTheDocument()
    expect(screen.getByText(T.tagline)).toBeInTheDocument()
    expect(screen.getByPlaceholderText(T.search)).toBeInTheDocument()
  })

  it('renders carousel prev/next controls and slide dots for a multi-photo set', () => {
    renderHero()
    expect(screen.getByLabelText('Previous slide')).toBeInTheDocument()
    expect(screen.getByLabelText('Next slide')).toBeInTheDocument()
    expect(screen.getByLabelText('Go to slide 1')).toBeInTheDocument()
    expect(screen.getByLabelText('Go to slide 3')).toBeInTheDocument()
  })

  it('omits carousel controls entirely for a single-photo set', () => {
    renderHero({ photos: { manhyiaPalace: 'https://example.com/manhyia.jpg' } })
    expect(screen.queryByLabelText('Previous slide')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Next slide')).not.toBeInTheDocument()
  })

  it('advances the active slide when the next control is clicked', () => {
    renderHero()
    const first = screen.getByLabelText('Go to slide 1')
    expect(first).toHaveAttribute('aria-current', 'true')
    fireEvent.click(screen.getByLabelText('Next slide'))
    const second = screen.getByLabelText('Go to slide 2')
    expect(second).toHaveAttribute('aria-current', 'true')
    expect(first).toHaveAttribute('aria-current', 'false')
  })

  it('shows sign-up/login CTAs when logged out', () => {
    renderHero()
    expect(screen.getByText(T.login)).toBeInTheDocument()
    expect(screen.getByText(`✨ ${T.signup}`)).toBeInTheDocument()
  })

  it('shows an Akwaaba greeting instead of the CTAs when logged in', () => {
    renderHero({ user: { fullName: 'Kojo Mensah' } })
    expect(screen.getByText(/Akwaaba/)).toBeInTheDocument()
    expect(screen.queryByText(T.login)).not.toBeInTheDocument()
  })
})
