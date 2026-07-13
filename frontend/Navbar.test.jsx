import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import Navbar from './components/Navbar.jsx'

const T = { signup: 'Create Free Account', login: 'Sign In' }

function renderNavbar(props = {}) {
  return render(
    <Navbar
      page="home"
      setPage={vi.fn()}
      lang="en"
      setLang={vi.fn()}
      user={null}
      auth={{ logout: vi.fn() }}
      handleLogoClick={vi.fn()}
      setAuthModal={vi.fn()}
      setShowNotifs={vi.fn()}
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
    expect(screen.getAllByText(/Business/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Events/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/About/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Contact/).length).toBeGreaterThan(0)
  })

  it('navigates to the business page when Business is clicked', () => {
    const setPage = vi.fn()
    renderNavbar({ setPage })
    fireEvent.click(screen.getAllByText(/Business/)[0])
    expect(setPage).toHaveBeenCalledWith('business')
  })

  it('shows sign in/create account affordances when logged out, and the user name when logged in', () => {
    const { rerender } = renderNavbar()
    expect(screen.getAllByText(T.login).length).toBeGreaterThan(0)
    expect(screen.getAllByText(T.signup).length).toBeGreaterThan(0)

    rerender(
      <Navbar
        page="home" setPage={vi.fn()} lang="en" setLang={vi.fn()}
        user={{ fullName: 'Ama Boateng' }}
        auth={{ logout: vi.fn() }}
        handleLogoClick={vi.fn()} setAuthModal={vi.fn()}
        setShowNotifs={vi.fn()} T={T}
      />,
    )
    expect(screen.getAllByText(/Ama/).length).toBeGreaterThan(0)
  })

  it('toggles the mobile dropdown menu via the hamburger button', () => {
    renderNavbar()
    const hamburger = screen.getByLabelText('Open menu')
    expect(hamburger).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(hamburger)
    expect(screen.getByLabelText('Close menu')).toHaveAttribute('aria-expanded', 'true')
  })

  it('calls handleLogoClick and navigates home when the logo is clicked', () => {
    const handleLogoClick = vi.fn()
    const setPage = vi.fn()
    renderNavbar({ handleLogoClick, setPage })
    fireEvent.click(screen.getByText('AshantiHub'))
    expect(handleLogoClick).toHaveBeenCalledTimes(1)
    expect(setPage).toHaveBeenCalledWith('home')
  })
})
