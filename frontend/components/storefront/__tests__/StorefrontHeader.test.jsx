import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { server } from '../../../mocks/server.js'
import { gatedOpening } from '../../../mocks/opening.js'
import { TREE, TREE_URL, VISIT_URL, json } from '../../../mocks/storefront.js'
import StorefrontHeader from '../StorefrontHeader.jsx'

function renderWithClient(ui) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

function props(extra = {}) {
  return {
    user: null,
    setAuthModal: vi.fn(),
    setShowAccount: vi.fn(),
    setShowBizDash: vi.fn(),
    setShowPayments: vi.fn(),
    setShowCart: vi.fn(),
    setShowFavs: vi.fn(),
    setShowNotifs: vi.fn(),
    onSignOut: vi.fn(),
    cartCount: 0,
    wishlistCount: 0,
    notifCount: 0,
    theme: 'light',
    toggleTheme: vi.fn(),
    onNavigate: vi.fn(),
    onLogoClick: vi.fn(),
    ...extra,
  }
}

const CUSTOMER = { fullName: 'Ama Boateng', accountType: 'customer', id: 1 }

describe('StorefrontHeader', () => {
  it('wishlist_and_cart_present_cart_greyed_before_opening', async () => {
    server.use(gatedOpening({ opensAt: '2026-11-06T06:00:00Z', serverNow: '2026-11-03T06:00:00Z' }))
    const p = props({ wishlistCount: 2 })
    renderWithClient(<StorefrontHeader {...p} />)
    const wishlist = screen.getByRole('button', { name: /Wishlist/ })
    expect(wishlist).toBeEnabled()
    expect(wishlist).toHaveTextContent('2')
    fireEvent.click(wishlist)
    expect(p.setShowFavs).toHaveBeenCalledWith(true)
    const cart = await screen.findByRole('button', { name: /Cart.*Opens 6 Nov/ })
    expect(cart).toBeDisabled()
    expect(cart).toHaveTextContent('Opens 6 Nov')
  })

  it('cart opens the drawer for a customer once open', async () => {
    const p = props({ user: CUSTOMER, cartCount: 3 })
    renderWithClient(<StorefrontHeader {...p} />)
    const cart = screen.getByRole('button', { name: /^Cart/ })
    await waitFor(() => expect(cart).toBeEnabled())
    expect(cart).toHaveTextContent('3')
    fireEvent.click(cart)
    expect(p.setShowCart).toHaveBeenCalledWith(true)
  })

  it('deliver to Ghana when signed out — no invented address', () => {
    renderWithClient(<StorefrontHeader {...props()} />)
    expect(screen.getByText('Deliver to')).toBeInTheDocument()
    expect(screen.getByText('Ghana')).toBeInTheDocument()
  })

  it("shows a signed-in customer's saved address", async () => {
    server.use(http.get('http://localhost:8000/api/accounts/customers/me/profile/', () => HttpResponse.json({ id: 1, full_name: 'Ama Boateng', address: 'Asokwa, Kumasi' })))
    renderWithClient(<StorefrontHeader {...props({ user: CUSTOMER })} />)
    expect(await screen.findByText('Asokwa, Kumasi')).toBeInTheDocument()
    expect(screen.getByText('Deliver to Ama')).toBeInTheDocument()
  })

  it('sign in opens the auth modal; the theme toggle works', () => {
    const p = props()
    renderWithClient(<StorefrontHeader {...p} />)
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }))
    expect(p.setAuthModal).toHaveBeenCalledWith('login')
    fireEvent.click(screen.getByRole('button', { name: 'Toggle theme' }))
    expect(p.toggleTheme).toHaveBeenCalledTimes(1)
  })

  it('signed-in account menu reaches My Account and Sign Out', () => {
    const p = props({ user: CUSTOMER })
    renderWithClient(<StorefrontHeader {...p} />)
    fireEvent.click(screen.getByRole('button', { name: 'Account menu' }))
    fireEvent.click(screen.getByRole('button', { name: /My Account/ }))
    expect(p.setShowAccount).toHaveBeenCalledWith(true)
    fireEvent.click(screen.getByRole('button', { name: 'Account menu' }))
    fireEvent.click(screen.getByRole('button', { name: /Sign Out/ }))
    expect(p.onSignOut).toHaveBeenCalledTimes(1)
  })

  it('secondary strip lists departments from the shopper tree and sends the visit beacon', async () => {
    const visited = []
    server.use(
      json(TREE_URL, TREE),
      http.post(VISIT_URL, ({ params }) => { visited.push(params.id); return new HttpResponse(null, { status: 204 }) }),
    )
    const p = props()
    renderWithClient(<StorefrontHeader {...p} />)
    const strip = screen.getByRole('navigation', { name: 'Departments' })
    fireEvent.click(await within(strip).findByRole('button', { name: 'Electronics' }))
    expect(p.onNavigate).toHaveBeenCalledWith('/business?category=electronics')
    fireEvent.click(within(strip).getByRole('button', { name: 'Concerts' }))
    expect(p.onNavigate).toHaveBeenCalledWith('/events?category=concerts')
    await waitFor(() => expect(visited).toEqual(['10', '40']))
    // Sub-categories are not in the strip.
    expect(within(strip).queryByRole('button', { name: 'Headphones' })).not.toBeInTheDocument()
  })

  describe('--ah-header-h (the browse rail sticks below it)', () => {
    const headerH = () => document.documentElement.style.getPropertyValue('--ah-header-h')
    const rect = (height) => ({ height, width: 1200, top: 0, left: 0, right: 1200, bottom: height, x: 0, y: 0, toJSON() {} })
    let restore = []
    afterEach(() => { restore.forEach((fn) => fn()); restore = [] })

    it('publishes its measured height, follows resizes and removes it on unmount', () => {
      const observers = []
      const original = globalThis.ResizeObserver
      globalThis.ResizeObserver = class {
        constructor(cb) { this.cb = cb; this.observed = []; observers.push(this) }
        observe(el) { this.observed.push(el) }
        unobserve() {}
        disconnect() { this.disconnected = true }
      }
      const spy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(rect(112))
      restore = [() => { globalThis.ResizeObserver = original }, () => spy.mockRestore()]

      const { unmount } = renderWithClient(<StorefrontHeader {...props()} />)
      expect(headerH()).toBe('112px')
      expect(observers).toHaveLength(1)
      expect(observers[0].observed[0].tagName).toBe('HEADER')

      spy.mockReturnValue(rect(148))
      act(() => observers[0].cb([]))
      expect(headerH()).toBe('148px')

      unmount()
      expect(observers[0].disconnected).toBe(true)
      expect(headerH()).toBe('')
    })

    it('still publishes once, without a ResizeObserver', () => {
      const original = globalThis.ResizeObserver
      globalThis.ResizeObserver = undefined
      const spy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(rect(96))
      restore = [() => { globalThis.ResizeObserver = original }, () => spy.mockRestore()]

      const { unmount } = renderWithClient(<StorefrontHeader {...props()} />)
      expect(headerH()).toBe('96px')
      unmount()
      expect(headerH()).toBe('')
    })
  })
})
