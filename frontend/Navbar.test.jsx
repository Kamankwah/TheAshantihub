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
      setShowBizDash={vi.fn()}
      setShowPayments={vi.fn()}
      setShowAccount={vi.fn()}
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

  it('shows sign in/create account when logged out, and hides them completely when logged in', () => {
    const { rerender } = renderNavbar()
    expect(screen.getAllByText(T.login).length).toBeGreaterThan(0)
    expect(screen.getAllByText(T.signup).length).toBeGreaterThan(0)

    rerender(
      <Navbar
        page="home" setPage={vi.fn()} lang="en" setLang={vi.fn()}
        user={{ fullName: 'Ama Boateng', accountType: 'customer' }}
        auth={{ logout: vi.fn() }}
        handleLogoClick={vi.fn()} setAuthModal={vi.fn()}
        setShowNotifs={vi.fn()} setShowBizDash={vi.fn()} setShowPayments={vi.fn()} setShowAccount={vi.fn()}
        T={T}
      />,
    )
    expect(screen.queryByText(T.login)).not.toBeInTheDocument()
    expect(screen.queryByText(T.signup)).not.toBeInTheDocument()
  })

  it('customer: shows a My Account button that opens the account panel', () => {
    const setShowAccount = vi.fn()
    renderNavbar({ user: { fullName: 'Ama Boateng', accountType: 'customer' }, setShowAccount })
    fireEvent.click(screen.getByText('👤 My Account'))
    expect(setShowAccount).toHaveBeenCalledWith(true)
  })

  it('business owner: shows a My Dashboard button that opens the business dashboard', () => {
    const setShowBizDash = vi.fn()
    renderNavbar({ user: { fullName: 'Kojo Mensah', accountType: 'business_owner' }, setShowBizDash })
    fireEvent.click(screen.getByText('🏪 My Dashboard'))
    expect(setShowBizDash).toHaveBeenCalledWith(true)
  })

  it('opens the profile menu from the round avatar button, showing the user\'s name and a Sign Out action', () => {
    const logout = vi.fn()
    renderNavbar({ user: { fullName: 'Ama Boateng', accountType: 'customer' }, auth: { logout } })
    fireEvent.click(screen.getByLabelText('Account menu'))
    expect(screen.getByText('Ama Boateng')).toBeInTheDocument()
    fireEvent.click(screen.getByText('⏻ Sign Out'))
    expect(logout).toHaveBeenCalledTimes(1)
  })

  it('business owner profile menu offers Business Dashboard and Payments', () => {
    const setShowPayments = vi.fn()
    renderNavbar({ user: { fullName: 'Kojo Mensah', accountType: 'business_owner' }, setShowPayments })
    fireEvent.click(screen.getByLabelText('Account menu'))
    expect(screen.getByText('🏪 Business Dashboard')).toBeInTheDocument()
    fireEvent.click(screen.getByText('💳 Payments'))
    expect(setShowPayments).toHaveBeenCalledWith(true)
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
