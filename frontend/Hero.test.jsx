import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import Hero from './components/Hero.jsx'

const T = {
  signup: 'Create Free Account',
  login: 'Sign In',
}

function renderHero(props = {}) {
  return render(
    <Hero
      T={T}
      user={null}
      setAuthModal={vi.fn()}
      setPage={vi.fn()}
      {...props}
    />,
  )
}

describe('Hero', () => {
  it('renders the opening Ghana-stats heading and national stats', () => {
    renderHero()
    expect(screen.getByText(/A Nation Wired/)).toBeInTheDocument()
    expect(screen.getByText('100K+')).toBeInTheDocument()
    expect(screen.getByText('Annual Visitors')).toBeInTheDocument()
  })

  it('renders all four section badges for the scroll narrative', () => {
    renderHero()
    expect(screen.getByText('GHANA RISING')).toBeInTheDocument()
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
})
