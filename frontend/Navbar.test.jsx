import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import Navbar from './components/Navbar.jsx'

const T = { signup: 'Create Free Account' }

function renderNavbar(props = {}) {
  return render(
    <Navbar
      page="home"
      setPage={vi.fn()}
      lang="en"
      setLang={vi.fn()}
      currency="GHS"
      setCurrency={vi.fn()}
      user={null}
      auth={{ logout: vi.fn() }}
      handleLogoClick={vi.fn()}
      setAuthModal={vi.fn()}
      setShowNotifs={vi.fn()}
      setShowMessaging={vi.fn()}
      setShowFavs={vi.fn()}
      favourites={[]}
      unreadMessages={0}
      setShowBizDash={vi.fn()}
      setShowPayments={vi.fn()}
      T={T}
      {...props}
    />,
  )
}

describe('Navbar', () => {
  it('renders the brand and nav links', () => {
    renderNavbar()
    expect(screen.getByText('AshantiHub')).toBeInTheDocument()
    expect(screen.getAllByText(/Home/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Events/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/About/).length).toBeGreaterThan(0)
  })

  it('shows a sign-up affordance when logged out, and the user name when logged in', () => {
    const { rerender } = renderNavbar()
    expect(screen.getAllByText(/Up$/).length).toBeGreaterThan(0)

    rerender(
      <Navbar
        page="home" setPage={vi.fn()} lang="en" setLang={vi.fn()}
        currency="GHS" setCurrency={vi.fn()}
        user={{ fullName: 'Ama Boateng' }}
        auth={{ logout: vi.fn() }}
        handleLogoClick={vi.fn()} setAuthModal={vi.fn()}
        setShowNotifs={vi.fn()} setShowMessaging={vi.fn()}
        setShowFavs={vi.fn()} favourites={[]} unreadMessages={0}
        setShowBizDash={vi.fn()} setShowPayments={vi.fn()} T={T}
      />,
    )
    expect(screen.getAllByText(/Ama/).length).toBeGreaterThan(0)
  })

  it('shows the unread-messages badge count when there are unread messages', () => {
    renderNavbar({ unreadMessages: 3 })
    expect(screen.getAllByText('3').length).toBeGreaterThan(0)
  })

  it('toggles the mobile dropdown menu via the hamburger button', () => {
    renderNavbar()
    const hamburger = screen.getByLabelText('Open menu')
    expect(hamburger).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(hamburger)
    expect(screen.getByLabelText('Close menu')).toHaveAttribute('aria-expanded', 'true')
  })

  it('calls handleLogoClick when the logo is clicked (5-click staff gesture)', () => {
    const handleLogoClick = vi.fn()
    renderNavbar({ handleLogoClick })
    fireEvent.click(screen.getByText('AshantiHub'))
    expect(handleLogoClick).toHaveBeenCalledTimes(1)
  })
})
