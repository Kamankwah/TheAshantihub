import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import Hero from './components/Hero.jsx'
import { server } from './mocks/server.js'

const T = {
  signup: 'Create Free Account',
  login: 'Sign In',
}

function renderHero(props = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <Hero
        T={T}
        user={null}
        setAuthModal={vi.fn()}
        setPage={vi.fn()}
        {...props}
      />
    </QueryClientProvider>,
  )
}

function mockListingCount(count) {
  server.use(
    http.get('http://localhost:8000/api/listings/', () =>
      HttpResponse.json({ count, next: null, previous: null, results: [] })),
  )
}

describe('Hero', () => {
  it('renders the opening heading with live listing and category counts from the API', async () => {
    mockListingCount(42)
    renderHero()
    expect(screen.getByText(/A Kingdom Wired/)).toBeInTheDocument()
    expect(await screen.findByText('42')).toBeInTheDocument()
    expect(screen.getByText('Listings')).toBeInTheDocument()
    // the shared mock serves two categories
    expect(await screen.findByText('2')).toBeInTheDocument()
    expect(screen.getByText('Categories')).toBeInTheDocument()
  })

  it('never shows invented figures', async () => {
    mockListingCount(42)
    renderHero()
    await screen.findByText('42')
    expect(screen.queryByText('Annual Visitors')).not.toBeInTheDocument()
    expect(screen.queryByText(/100K\+/)).not.toBeInTheDocument()
    expect(screen.queryByText(/65\+/)).not.toBeInTheDocument()
  })

  it('leaves the listing count out while there are no listings yet', async () => {
    mockListingCount(0)
    renderHero()
    await screen.findByText('Categories')
    expect(screen.queryByText('Listings')).not.toBeInTheDocument()
  })

  it('renders all four section badges for the scroll narrative', () => {
    renderHero()
    expect(screen.getByText('ASHANTI RISING')).toBeInTheDocument()
    expect(screen.getByText('THE ASHANTI REGION')).toBeInTheDocument()
    expect(screen.getByText('CULTURE & FESTIVALS')).toBeInTheDocument()
    expect(screen.getByText('BUILT FOR ASHANTI, BY ASHANTI')).toBeInTheDocument()
  })

  it('the opening section\'s CTA navigates to the Business page', () => {
    const setPage = vi.fn()
    renderHero({ setPage })
    fireEvent.click(screen.getByText('Explore Businesses in Ashanti →'))
    expect(setPage).toHaveBeenCalledWith('business')
  })

  it('the business section\'s CTA navigates to the Business page', () => {
    const setPage = vi.fn()
    renderHero({ setPage })
    fireEvent.click(screen.getByText('View Businesses in Ashanti Region →'))
    expect(setPage).toHaveBeenCalledWith('business')
  })

  it('the events section\'s CTA navigates to the Events page', () => {
    const setPage = vi.fn()
    renderHero({ setPage })
    fireEvent.click(screen.getByText('View Events in Ashanti Region →'))
    expect(setPage).toHaveBeenCalledWith('events')
  })

  it('shows sign-up/login CTAs in the closing section when logged out', () => {
    renderHero()
    expect(screen.getByText(T.login)).toBeInTheDocument()
    expect(screen.getByText(T.signup)).toBeInTheDocument()
  })

  it('shows an Akwaaba greeting instead of auth CTAs when logged in', () => {
    renderHero({ user: { fullName: 'Kojo Mensah' } })
    expect(screen.getByText(/Akwaaba/)).toBeInTheDocument()
    expect(screen.queryByText(T.login)).not.toBeInTheDocument()
  })

  it('clicking sign up in the closing section calls setAuthModal', () => {
    const setAuthModal = vi.fn()
    renderHero({ setAuthModal })
    fireEvent.click(screen.getByText(T.signup))
    expect(setAuthModal).toHaveBeenCalledWith('signup')
  })

  it('renders one photograph per section, each with descriptive alt text', () => {
    renderHero()
    expect(screen.getByAltText(/kente weaver/i)).toBeInTheDocument()
    expect(screen.getByAltText(/Kejetia Market/i)).toBeInTheDocument()
    expect(screen.getByAltText(/Akwasidae Festival/i)).toBeInTheDocument()
    expect(screen.getByAltText(/Manhyia Palace/i)).toBeInTheDocument()
  })
})
