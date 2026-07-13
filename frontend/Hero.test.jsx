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
      setPage={vi.fn()}
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

  it('shows sign-up/login CTAs when logged out', () => {
    renderHero()
    expect(screen.getByText(T.login)).toBeInTheDocument()
    expect(screen.getAllByText(`✨ ${T.signup}`).length).toBeGreaterThan(0)
  })

  it('shows an Akwaaba greeting instead of the CTAs when logged in', () => {
    renderHero({ user: { fullName: 'Kojo Mensah' } })
    expect(screen.getByText(/Akwaaba/)).toBeInTheDocument()
    expect(screen.queryByText(T.login)).not.toBeInTheDocument()
  })

  it('typing in the search box calls setSearchInput and setShowSearchResults', () => {
    const setSearchInput = vi.fn()
    const setShowSearchResults = vi.fn()
    renderHero({ setSearchInput, setShowSearchResults })
    fireEvent.change(screen.getByPlaceholderText(T.search), { target: { value: 'kente' } })
    expect(setSearchInput).toHaveBeenCalledWith('kente')
    expect(setShowSearchResults).toHaveBeenCalledWith(true)
  })

  it('renders all four section badges for the scroll narrative', () => {
    renderHero()
    expect(screen.getByText('WELCOME TO ASHANTI')).toBeInTheDocument()
    expect(screen.getByText('GHANA RISING')).toBeInTheDocument()
    expect(screen.getByText('THE ASHANTI REGION')).toBeInTheDocument()
    expect(screen.getByText('BUILT FOR ASHANTI, BY ASHANTI')).toBeInTheDocument()
  })

  it('clicking "Register Your Business" in the join section calls setPage', () => {
    const setPage = vi.fn()
    renderHero({ setPage })
    fireEvent.click(screen.getByText('Register Your Business'))
    expect(setPage).toHaveBeenCalledWith('register')
  })

  it('toggles map view via the quick-action button', () => {
    const setShowMap = vi.fn()
    renderHero({ setShowMap })
    fireEvent.click(screen.getByText(/Map View/))
    expect(setShowMap).toHaveBeenCalled()
  })
})
