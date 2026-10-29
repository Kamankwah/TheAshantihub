import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { server } from '../mocks/server.js'
import BusinessCommandCenter from '../components/dashboard/BusinessCommandCenter.jsx'
import AshantiHub, { AuthModal, MessagingCenter, MoMoPayment, StaffDashboard, UserPanel } from '../App.jsx'
import { MemoryRouter } from 'react-router-dom'
import { setStoredAuth } from '../apiClient.js'
import { fullHome } from '../mocks/storefront.js'
import StorefrontHeader from '../components/storefront/StorefrontHeader.jsx'
import StorefrontHome from '../components/storefront/StorefrontHome.jsx'
import ListingDetailPage from '../components/ListingDetailPage.jsx'
import CartDrawer from '../components/CartDrawer.jsx'
import CheckoutPage from '../components/shop/CheckoutPage.jsx'

// Per-area smoke tests: render a key page with <html data-theme="dark"> and
// assert nothing on it is a light-only inline surface or light-only text.
// The palette itself is CSS variables (theme.test.jsx), so here "dark-ready"
// means every inline surface/text colour is a theme token (var(--ah-*)) or a
// fixed brand fill — never a hardcoded white/cream surface, nor dark-brown/
// grey text sitting on a themed surface. QR codes ([data-paper]) stay white.

const API = 'http://localhost:8000'

function withClient(ui) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

const parseRgb = (s) => [...(s || '').matchAll(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/g)]
  .map((m) => ({ c: [+m[1], +m[2], +m[3]], a: m[4] === undefined ? 1 : +m[4] }))
const NAMED = { white: [255, 255, 255], black: [0, 0, 0] }

// A theme token (var(--ah-*, <light fallback>)) follows the theme: its
// fallback is not what renders in dark mode, so it is not inspected.
const stripTokens = (value) => (value || '').replace(/var\(--ah-[\w-]+,[^()]*(\([^()]*\)[^()]*)*\)/g, 'TOKEN')

function colours(value) {
  value = stripTokens(value)
  const out = parseRgb(value)
  for (const [name, c] of Object.entries(NAMED)) if (new RegExp(`\\b${name}\\b`).test(value || '')) out.push({ c, a: 1 })
  return out
}
const isLight = ({ c, a }) => Math.min(...c) >= 224 && a >= 0.5
// dark ink: dark brown, black and the mid/dark greys used for body text
const isDarkInk = ({ c, a }) => a >= 0.3 && Math.max(...c) <= 0x88 && Math.max(...c) - Math.min(...c) <= 40
// fixed fills that keep dark text in both themes (gold, light gold, Ghana gold, orange, white paper)
const isFixedLightFill = ({ c }) => c[0] >= 0xb8 && c[1] >= 0x60 && c[2] <= 0xb3

function backgroundOf(el) {
  return el.style.backgroundColor || el.style.background || el.style.backgroundImage || ''
}

function nearestFill(el) {
  for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
    const bg = backgroundOf(n)
    if (bg && !/^(none|transparent|inherit)$/.test(bg)) return { el: n, bg }
  }
  return null
}

export function lightOnlyStyles(root = document.body) {
  const problems = []
  for (const el of root.querySelectorAll('[style]')) {
    if (el.closest('[data-paper]')) continue
    const bg = backgroundOf(el)
    for (const col of colours(bg)) {
      if (isLight(col)) problems.push(`light surface ${bg} on <${el.tagName.toLowerCase()}> "${el.textContent.slice(0, 40)}"`)
    }
    const text = colours(el.style.color)[0]
    if (text && isDarkInk(text)) {
      const fill = nearestFill(el)
      const fills = fill && !/var\(--ah-|TOKEN/.test(stripTokens(fill.bg)) ? colours(fill.bg) : []
      const onFixed = fills.length > 0 && fills.every((f) => isFixedLightFill(f) || isLight(f))
      if (!onFixed) problems.push(`dark text ${el.style.color} on themed surface <${el.tagName.toLowerCase()}> "${el.textContent.slice(0, 40)}"`)
    }
  }
  return problems
}

const usesThemeTokens = (root = document.body) =>
  [...root.querySelectorAll('[style]')].some((el) => /var\(--ah-/.test(el.getAttribute('style')))

// framer-motion's whileInView (the shadcn About page) needs an observer
class FakeIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() { return [] }
}

beforeEach(() => {
  window.IntersectionObserver = FakeIntersectionObserver
  Element.prototype.scrollIntoView = Element.prototype.scrollIntoView || (() => {})
  document.documentElement.dataset.theme = 'dark'
  document.documentElement.classList.add('dark')
})
afterEach(() => {
  delete window.IntersectionObserver
  delete document.documentElement.dataset.theme
  document.documentElement.classList.remove('dark')
})

describe('dark mode smoke helper', () => {
  it('flags hardcoded light surfaces and dark text on themed surfaces, not tokens, brand fills or QR paper', () => {
    const { container } = render(
      <div>
        <div style={{ background: 'white' }}>a</div>
        <div style={{ background: 'var(--ah-surface, #FFFFFF)' }}><span style={{ color: '#555' }}>b</span></div>
        <div style={{ background: 'var(--ah-surface, #FFFFFF)', color: 'var(--ah-ink, #2C1810)' }}>c</div>
        <button type="button" style={{ background: '#D4A017', color: '#2C1810' }}>d</button>
        <img alt="qr" data-paper="" style={{ background: '#FFFFFF' }} />
      </div>,
    )
    const found = lightOnlyStyles(container)
    expect(found).toHaveLength(2)
    expect(found[0]).toMatch(/light surface/)
    expect(found[1]).toMatch(/dark text/)
  })
})

describe('dark mode smoke: business dashboard', () => {
  it('the business dashboard renders with theme tokens and no light-only surfaces', async () => {
    server.use(
      http.get(`${API}/api/listings/mine/`, () => HttpResponse.json([])),
      http.get(`${API}/api/accounts/business-owners/me/profile/`, () => HttpResponse.json({ ghana_card_number: 'GHA-1', gps_address: 'AK-1', is_formal: false })),
      http.get(`${API}/api/billing/plans/`, () => HttpResponse.json([])),
      http.get(`${API}/api/billing/subscriptions/me/`, () => HttpResponse.json({})),
      http.get(`${API}/api/hero/mine/`, () => HttpResponse.json({})),
    )
    const toggleTheme = vi.fn()
    withClient(
      <BusinessCommandCenter
        onExit={vi.fn()} auth={{ logout: vi.fn(), refreshUser: vi.fn() }} PaymentComponent={() => null}
        user={{ fullName: 'Abena', accountType: 'business_owner', kycStatus: 'verified' }}
        theme="dark" toggleTheme={toggleTheme}
      />,
    )
    await screen.findByText(/Akwaaba, Abena/)
    screen.getByRole('button', { name: 'Toggle theme' }).click()
    expect(toggleTheme).toHaveBeenCalled()
    expect(usesThemeTokens()).toBe(true)
    expect(lightOnlyStyles()).toEqual([])
  })
})

describe('dark mode smoke: staff shell', () => {
  it('the staff shell renders with theme tokens, a theme toggle and no light-only surfaces', async () => {
    setStoredAuth({ token: 't', account_type: 'staff', id: 1, full_name: 'Akosua Support', role: 'accountant', permissions: ['messaging.manage', 'disputes.flag', 'users.view'] })
    const auth = {
      user: { token: 't', account_type: 'staff', id: 1, full_name: 'Akosua Support', role: 'accountant', permissions: ['messaging.manage', 'disputes.flag', 'users.view'] },
      hasPermission: (c) => ['messaging.manage', 'disputes.flag', 'users.view'].includes(c),
    }
    const toggleTheme = vi.fn()
    withClient(<StaffDashboard auth={auth} onExit={vi.fn()} theme="dark" toggleTheme={toggleTheme} />)
    await screen.findByText(/Akwaaba, Akosua/)
    screen.getByRole('button', { name: 'Toggle theme' }).click()
    expect(toggleTheme).toHaveBeenCalled()
    expect(usesThemeTokens()).toBe(true)
    expect(lightOnlyStyles()).toEqual([])
    setStoredAuth(null)
  })
})

describe('dark mode smoke: home', () => {
  it('the marketplace home renders with theme tokens and no light-only surfaces', async () => {
    server.use(...fullHome())
    const header = (
      <StorefrontHeader
        user={null} setAuthModal={vi.fn()} setShowAccount={vi.fn()} setShowBizDash={vi.fn()} setShowPayments={vi.fn()}
        setShowCart={vi.fn()} setShowFavs={vi.fn()} setShowNotifs={vi.fn()} onSignOut={vi.fn()} cartCount={0}
        wishlistCount={0} notifCount={0} theme="dark" toggleTheme={vi.fn()} onNavigate={vi.fn()} onLogoClick={vi.fn()}
      />
    )
    withClient(<StorefrontHome header={header} user={null} onNavigate={vi.fn()} onOpenListing={vi.fn()} onSignIn={vi.fn()} onSell={vi.fn()} />)
    await screen.findByRole('heading', { name: "Today's deals" })
    await screen.findByRole('heading', { name: 'Most visited categories' })
    expect(screen.getByTestId('storefront-home').getAttribute('style')).toContain('var(--ah-canvas')
    expect(lightOnlyStyles()).toEqual([])
  })
})

describe('dark mode smoke: listing detail', () => {
  it('a product page renders with no light-only surfaces', async () => {
    server.use(http.get(`${API}/api/listings/1/`, () => HttpResponse.json({
      id: 1, name: 'Royal Ashanti Lodge', description: 'Luxury rooms.', category: { slug: 'hotels', icon: '🏨', label: 'Hotels', color: '#000080', kind: 'product' },
      zone: { name: 'Manhyia' }, price_amount: '450.00', price_unit: '/night', tag: 'Featured', lat: null, lng: null, main_photo: null, photos: [],
      created_at: '2026-07-09T00:00:00Z', is_promoted: false, specs: [{ label: 'Bed size', value: 'King' }], service_duration: '',
      avg_rating: 4.5, review_count: 2, business_owner: { id: 9, full_name: 'Ama Boateng', kyc_status: 'verified' },
    })))
    withClient(
      <ListingDetailPage id={1} onBack={vi.fn()} user={null} favourites={[]} onFavourite={vi.fn()} currency="GHS" onMessage={vi.fn()}
        onAddToCart={vi.fn().mockResolvedValue(undefined)} CardComponent={({ item }) => <div>{item.name}</div>} />,
    )
    await screen.findByText('Royal Ashanti Lodge')
    expect(lightOnlyStyles()).toEqual([])
  })
})

describe('dark mode smoke: cart drawer', () => {
  it('the cart drawer (items, subtotal, Go to cart) renders with theme tokens and no light-only surfaces', async () => {
    server.use(http.get(`${API}/api/cart/`, () => HttpResponse.json({
      id: 1, total: '300.00', created_at: '2026-07-01T00:00:00Z', updated_at: '2026-07-10T00:00:00Z',
      items: [{ id: 10, listing: 5, listing_name: 'Kente Cloth', quantity: 2, unit_price_snapshot: '150.00', line_total: '300.00', added_at: '2026-07-10T00:00:00Z' }],
    })))
    withClient(<CartDrawer onClose={vi.fn()} user={{ fullName: 'Ama Boateng', accountType: 'customer' }} onGoToCart={vi.fn()} />)
    await screen.findByText('Kente Cloth')
    expect(usesThemeTokens()).toBe(true)
    expect(lightOnlyStyles()).toEqual([])
  })
})

describe('dark mode smoke: account', () => {
  it('every account tab renders with theme tokens and no light-only surfaces', async () => {
    withClient(
      <MemoryRouter initialEntries={['/my-account']}>
        <UserPanel user={{ fullName: 'Ama Boateng', accountType: 'customer', id: 1, avatar: null }} auth={{ updateProfile: vi.fn(), refreshUser: vi.fn() }}
          favourites={[]} toggleFav={vi.fn()} onExit={vi.fn()} PaymentComponent={() => null} theme="dark" toggleTheme={vi.fn()} />
      </MemoryRouter>,
    )
    await screen.findByText('Total Orders')
    expect(screen.getByRole('button', { name: 'Toggle theme' })).toBeInTheDocument()
    expect(usesThemeTokens()).toBe(true)
    expect(lightOnlyStyles()).toEqual([])
    // The hub's eight sections (each opened from its tile), then the Orders section's tabs.
    for (const tile of ['Your Orders', 'Login & security', 'Your Addresses', 'Your Payments', 'Your Lists', 'Customer Service', 'Your Messages', 'Sell on AshantiHub']) {
      fireEvent.click(screen.getByRole('link', { name: new RegExp(tile) }))
      await new Promise((r) => setTimeout(r, 30))
      expect(lightOnlyStyles(), tile).toEqual([])
      fireEvent.click(screen.getByRole('button', { name: 'Your Account home' }))
    }
    fireEvent.click(screen.getByRole('link', { name: /Your Orders/ }))
    for (const tab of ['Bookings', 'Service requests', 'Tickets', 'My events']) {
      fireEvent.click(screen.getByRole('tab', { name: tab }))
      await new Promise((r) => setTimeout(r, 30))
      expect(lightOnlyStyles(), tab).toEqual([])
    }
  })
})

describe('dark mode smoke: public pages', () => {
  it.each(['/business', '/events', '/about', '/contact', '/faq', '/no-such-page'])('%s renders with theme tokens and no light-only surfaces', async (path) => {
    localStorage.setItem('ashantihub.theme', 'dark')
    withClient(<MemoryRouter initialEntries={[path]}><AshantiHub /></MemoryRouter>)
    await new Promise((r) => setTimeout(r, 2100)) // past the splash screen
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(usesThemeTokens()).toBe(true)
    expect(lightOnlyStyles()).toEqual([])
    localStorage.removeItem('ashantihub.theme')
  }, 10000)
})

// Every inline surface/ink on the element set comes from a theme token.
const tokenised = (els, prop) => els.filter((el) => el.style[prop] && !/^(none|transparent|inherit)$/.test(el.style[prop]))
  .every((el) => /var\(--ah-|color-mix/.test(el.getAttribute('style')))

describe('dark mode smoke: modals, drawers and panels', () => {
  it('messaging centre: rows, thread and hover keep theme surfaces', async () => {
    server.use(http.get(`${API}/api/messaging/conversations/`, () => HttpResponse.json([
      { id: 1, customer: 1, business_owner: null, starter_name: 'Yaw', subject: 'Re: Kente stole', status: 'open',
        messages: [{ id: 1, conversation: 1, sender_type: 'staff', body: 'Ready soon.', created_at: '2026-10-05T09:27:00Z' }],
        created_at: '2026-10-05T09:24:00Z', updated_at: '2026-10-05T09:27:00Z' },
      { id: 2, customer: 1, business_owner: null, starter_name: 'Yaw', subject: 'Re: Lodge', status: 'open',
        messages: [{ id: 3, conversation: 2, sender_type: 'customer', body: 'Is it free?', created_at: '2026-10-04T09:27:00Z' }],
        created_at: '2026-10-04T09:24:00Z', updated_at: '2026-10-04T09:27:00Z' },
    ])))
    withClient(<MessagingCenter user={{ id: 1, fullName: 'Yaw', accountType: 'customer' }} onClose={vi.fn()} />)
    const rows = await screen.findAllByText('AshantiHub Support')
    for (const label of rows) {
      const row = label.closest('[style*="cursor: pointer"]') || label.parentElement
      fireEvent.mouseEnter(row)
      expect(row.style.background, 'hover').not.toMatch(/rgb\((255, 255, 255|250, 250, 250)\)|white|#fafafa/)
      if (row.style.background) expect(row.style.background).toMatch(/var\(--ah-|color-mix/)
      fireEvent.mouseLeave(row)
      expect(row.style.background, 'leave').not.toMatch(/rgb\((255, 255, 255|250, 250, 250)\)|white|#fafafa/)
    }
    expect(usesThemeTokens()).toBe(true)
    expect(lightOnlyStyles()).toEqual([])
  })

  it.each(['login', 'signup'])('auth modal (%s) uses theme surfaces and inks', (authState) => {
    withClient(<AuthModal authState={authState} auth={{ login: vi.fn(), register: vi.fn() }} onClose={vi.fn()} onSuccess={vi.fn()} />)
    const styled = [...document.body.querySelectorAll('[style]')]
    expect(tokenised(styled.filter((el) => el.tagName === 'INPUT'), 'background')).toBe(true)
    expect(usesThemeTokens()).toBe(true)
    expect(lightOnlyStyles()).toEqual([])
  })

  it('MoMo payment modal: totals use the price token, no light surfaces', () => {
    withClient(<MoMoPayment amount={30} purpose="Event visibility payment" businessName="Ama" onSuccess={vi.fn()} onClose={vi.fn()} />)
    expect(lightOnlyStyles()).toEqual([])
    fireEvent.click(screen.getByText('MTN MoMo'))
    const total = screen.getAllByText(/^GHS \d/).at(-1)
    expect(total.getAttribute('style')).toContain('var(--ah-price')
    expect(usesThemeTokens()).toBe(true)
    expect(lightOnlyStyles()).toEqual([])
  })

  it('secure checkout: the order total uses the price token and nothing is light-only', async () => {
    server.use(
      http.get(`${API}/api/cart/`, () => HttpResponse.json({
        id: 1, total: '300.00', created_at: '2026-07-01T00:00:00Z', updated_at: '2026-07-10T00:00:00Z',
        items: [{ id: 10, listing: 5, listing_name: 'Kente Cloth', quantity: 2, unit_price_snapshot: '150.00', line_total: '300.00', added_at: '2026-07-10T00:00:00Z' }],
      })),
      http.get(`${API}/api/accounts/addresses/`, () => HttpResponse.json([{
        id: 1, label: 'Home', recipient_name: 'Ama Boateng', phone: '0241234567', gps_address: 'AK-039-5028', landmark: 'Opposite Total',
        address_text: '', lat: null, lng: null, is_default: true, created_at: '2026-10-28T09:15:22Z',
      }])),
    )
    withClient(<CheckoutPage user={{ fullName: 'Ama Boateng', accountType: 'customer' }} currency="GHS" PaymentComponent={() => null} onNavigate={vi.fn()} />)
    await screen.findByText('AK-039-5028')
    expect(await screen.findByTestId('summary-total')).toHaveTextContent('GH₵ 300.00')
    expect(screen.getByTestId('summary-total').getAttribute('style')).toContain('var(--ah-price')
    expect(usesThemeTokens()).toBe(true)
    expect(lightOnlyStyles()).toEqual([])
  })

  it('notifications panel and favourites drawer (from the marketplace header) use theme surfaces', async () => {
    setStoredAuth({ token: 't', account_type: 'customer', id: 2, full_name: 'Yaa' })
    server.use(http.get(`${API}/api/notifications/`, () => HttpResponse.json({ unread_count: 1, results: [
      { id: 1, title: 'Order shipped', body: 'Your kente is on the way', icon: '📦', is_read: false, created_at: '2026-10-19T09:00:00Z' },
    ] })))
    localStorage.setItem('ashantihub.theme', 'dark')
    withClient(<MemoryRouter initialEntries={['/']}><AshantiHub /></MemoryRouter>)
    fireEvent.click(await screen.findByRole('button', { name: 'Notifications' }, { timeout: 4000 }))
    const item = await screen.findByText('Order shipped')
    expect(item.getAttribute('style')).toContain('var(--ah-ink')
    expect(lightOnlyStyles()).toEqual([])
    fireEvent.click(screen.getByRole('button', { name: /^Wishlist/ }))
    const fav = await screen.findByText(/Saved items/)
    expect(fav.getAttribute('style')).toContain('var(--ah-ink')
    expect(fav.parentElement.getAttribute('style')).toContain('var(--ah-surface')
    expect(lightOnlyStyles()).toEqual([])
    localStorage.removeItem('ashantihub.theme')
    setStoredAuth(null)
  }, 12000)
})
