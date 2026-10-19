import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { server } from '../mocks/server.js'
import BusinessCommandCenter from '../components/dashboard/BusinessCommandCenter.jsx'
import { StaffDashboard } from '../App.jsx'
import { setStoredAuth } from '../apiClient.js'
import { fullHome } from '../mocks/storefront.js'
import StorefrontHeader from '../components/storefront/StorefrontHeader.jsx'
import StorefrontHome from '../components/storefront/StorefrontHome.jsx'
import ListingDetailPage from '../components/ListingDetailPage.jsx'
import CartDrawer from '../components/CartDrawer.jsx'

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

beforeEach(() => {
  document.documentElement.dataset.theme = 'dark'
  document.documentElement.classList.add('dark')
})
afterEach(() => {
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
  it('the cart drawer (items, totals, checkout button) renders with theme tokens and no light-only surfaces', async () => {
    server.use(http.get(`${API}/api/cart/`, () => HttpResponse.json({
      id: 1, total: '300.00', created_at: '2026-07-01T00:00:00Z', updated_at: '2026-07-10T00:00:00Z',
      items: [{ id: 10, listing: 5, listing_name: 'Kente Cloth', quantity: 2, unit_price_snapshot: '150.00', line_total: '300.00', added_at: '2026-07-10T00:00:00Z' }],
    })))
    withClient(<CartDrawer onClose={vi.fn()} user={{ fullName: 'Ama Boateng', accountType: 'customer' }} currency="GHS" PaymentComponent={() => null} />)
    await screen.findByText('Kente Cloth')
    expect(usesThemeTokens()).toBe(true)
    expect(lightOnlyStyles()).toEqual([])
  })
})
