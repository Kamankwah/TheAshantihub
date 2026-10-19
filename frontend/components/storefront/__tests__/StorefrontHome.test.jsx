import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { server } from '../../../mocks/server.js'
import { gatedOpening } from '../../../mocks/opening.js'
import { fullHome } from '../../../mocks/storefront.js'
import StorefrontHeader from '../StorefrontHeader.jsx'
import StorefrontHome from '../StorefrontHome.jsx'

function renderWithClient(ui) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

const before = (a, b) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)

function header() {
  return (
    <StorefrontHeader
      user={null} setAuthModal={vi.fn()} setShowAccount={vi.fn()} setShowBizDash={vi.fn()} setShowPayments={vi.fn()}
      setShowCart={vi.fn()} setShowFavs={vi.fn()} setShowNotifs={vi.fn()} onSignOut={vi.fn()} cartCount={0}
      wishlistCount={0} notifCount={0} theme="light" toggleTheme={vi.fn()} onNavigate={vi.fn()} onLogoClick={vi.fn()}
    />
  )
}

function home() {
  return (
    <StorefrontHome header={header()} user={null} onNavigate={vi.fn()} onOpenListing={vi.fn()} onSignIn={vi.fn()} onSell={vi.fn()} />
  )
}

describe('StorefrontHome', () => {
  it('takeover_first_before_opening', async () => {
    server.use(...fullHome(), gatedOpening({ opensAt: '2026-11-06T06:00:00Z', serverNow: '2026-11-03T06:00:00Z' }))
    renderWithClient(home())
    const takeover = (await screen.findByRole('button', { name: 'Notify me' })).closest('section')
    const bar = screen.getByRole('search')
    const slider = await screen.findByRole('region', { name: 'Featured slides' })
    expect(before(takeover, bar)).toBe(true)
    expect(before(bar, slider)).toBe(true)
  })

  it('slider_first_after_opening', async () => {
    server.use(...fullHome())
    renderWithClient(home())
    const slider = await screen.findByRole('region', { name: 'Featured slides' })
    const flash = await screen.findByText('Kente week: 20% off woven stoles')
    const deals = await screen.findByRole('heading', { name: "Today's deals" })
    const visited = await screen.findByRole('heading', { name: 'Most visited categories' })
    const cta = screen.getByRole('heading', { name: 'Sell on AshantiHub' })
    expect(screen.queryByRole('button', { name: 'Notify me' })).not.toBeInTheDocument()
    expect(before(screen.getByRole('search'), slider)).toBe(true)
    expect(before(slider, flash)).toBe(true)
    expect(before(flash, deals)).toBe(true)
    expect(before(deals, visited)).toBe(true)
    expect(before(visited, cta)).toBe(true)
  })

  it('no_contact_details_anywhere', async () => {
    server.use(...fullHome())
    const { container } = renderWithClient(home())
    await screen.findByRole('region', { name: 'Featured slides' })
    await screen.findByRole('heading', { name: "Today's deals" })
    await screen.findByRole('heading', { name: 'Most visited categories' })
    await screen.findByText('Kente week: 20% off woven stoles')
    expect(container.querySelectorAll('a[href^="tel:"], a[href^="mailto:"], a[href^="sms:"], a[href*="wa.me"], a[href*="whatsapp"]')).toHaveLength(0)
    expect(container.textContent).not.toMatch(/\+233|\b0[235]\d{8}\b|@[a-z0-9-]+\.[a-z]/i)
  })

  it('every feed empty: the header and the call to action still show', async () => {
    renderWithClient(home())
    expect(screen.getByRole('search')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Sell on AshantiHub' })).toBeInTheDocument()
    expect(screen.getByTestId('storefront-home')).toBeInTheDocument()
    await new Promise((r) => setTimeout(r, 80))
    expect(screen.queryByRole('region', { name: 'Featured slides' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: "Today's deals" })).not.toBeInTheDocument()
  })
})
