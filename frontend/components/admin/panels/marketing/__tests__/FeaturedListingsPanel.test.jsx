import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../../../../mocks/server.js'
import FeaturedListingsPanel from '../FeaturedListingsPanel.jsx'
import { API, renderMk } from './mkTestUtils.jsx'

const weeks = [{ start: '2026-10-12', label: '12–18 Oct', current: true }, { start: '2026-10-19', label: '19–25 Oct', current: false }]
const open = (w) => ({ week_start: w, state: 'open', booking_id: null })
const grid = (rows) => ({
  weeks, rows, summary: { week_label: '12–18 Oct', booked: 1, waiting: 1, list_price_total: '150.00' },
  prices: { slots: [{ key: 'home', label: 'Home featured row', weekly_price: '150.00', places: 4, per: 'places' }, { key: 'category_top', label: 'Category top', weekly_price: '60.00', places: 2, per: 'per category' }], promotion_daily_rate: '5.00', note: 'n' },
  categories: [{ id: 3, slug: 'food', label: 'Food' }],
  slots: [{ key: 'home-1', kind: 'home', label: 'Home · slot 1', capacity: 1, weekly_price: '150.00' }, { key: 'category-top', kind: 'category_top', label: 'Category top', capacity: 2, weekly_price: '60.00' }],
})
const cell = (state, extra = {}) => ({ week_start: '2026-10-12', state, booking_id: 7, business: 'Akosua Ntoma Kente', ...extra })
const rows = [
  { slot_key: 'home-1', kind: 'home', name: 'Home · slot 1', position: 1, category: null, weekly_price: '150.00', cells: [cell('booked'), open('2026-10-19')] },
  { slot_key: 'home-2', kind: 'home', name: 'Home · slot 2', position: 1, category: null, weekly_price: '150.00', cells: [cell('held', { booking_id: 8, business: 'Suame Auto Parts', reason: 'The business has an open fraud case.' }), open('2026-10-19')] },
]
const PERM = ['site_promo.manage']
const candidates = { promotions: [{ promotion_id: 9, status: 'active', listing_id: 1, listing_name: 'Kente stole', business: 'Adwoa Fabrics', paid_days: 7, weeks_paid: 1, weeks_placed: 0, blockers: [] }, { promotion_id: 10, status: 'pending', listing_id: 2, listing_name: 'Spare parts', business: 'Suame Auto', paid_days: 7, weeks_paid: 1, weeks_placed: 0, blockers: [{ code: 'fraud_hold', message: 'The business has an open fraud case.' }] }] }

describe('FeaturedListingsPanel', () => {
  it('shows the grid with booked, held and open places, prices, and the price-source caveat', async () => {
    server.use(http.get(`${API}/api/marketing/featured/grid/`, () => HttpResponse.json(grid(rows))), http.get(`${API}/api/marketing/featured/candidates/`, () => HttpResponse.json(candidates)))
    renderMk(FeaturedListingsPanel, { permissions: PERM })
    expect(await screen.findByText(/Home featured row: GH₵ 150.00 a week/)).toBeInTheDocument()
    expect(screen.getByText(/Category top: GH₵ 60.00 a week · 2 per category/)).toBeInTheDocument()
    expect(screen.getByText(/not reconciled yet/)).toBeInTheDocument()
    expect(screen.getByText(/Booked for 12–18 Oct: 1 slot · GH₵ 150.00 at list price/)).toBeInTheDocument()
    const held = screen.getByText('Suame Auto Parts').closest('td')
    expect(within(held).getByText(/Held: The business has an open fraud case/)).toBeInTheDocument()
    expect(within(screen.getByRole('table')).getAllByText('Open').length).toBe(2)
    expect(screen.getByText('✓ Verified')).toBeInTheDocument()
    expect(screen.getByText(/Earned when AshantiHub staff approve the business's Ghana Card\./)).toBeInTheDocument()
    expect(screen.queryByText(/Earned through KYC/)).not.toBeInTheDocument()
  })

  it('releases a booked place', async () => {
    let released = null
    server.use(
      http.get(`${API}/api/marketing/featured/grid/`, () => HttpResponse.json(grid(rows))), http.get(`${API}/api/marketing/featured/candidates/`, () => HttpResponse.json(candidates)),
      http.post(`${API}/api/marketing/featured/bookings/7/release/`, () => { released = true; return HttpResponse.json({ id: 7, status: 'released' }) }),
    )
    renderMk(FeaturedListingsPanel, { permissions: PERM })
    fireEvent.click(await screen.findByRole('button', { name: 'Release Home · slot 1 for Akosua Ntoma Kente' }))
    await waitFor(() => expect(released).toBe(true))
  })

  it('books a place and blocks a business with a hold in the form', async () => {
    let body = null
    server.use(
      http.get(`${API}/api/marketing/featured/grid/`, () => HttpResponse.json(grid(rows))), http.get(`${API}/api/marketing/featured/candidates/`, () => HttpResponse.json(candidates)),
      http.post(`${API}/api/marketing/featured/bookings/`, async ({ request }) => { body = await request.json(); return HttpResponse.json({ booked: [1], weeks: 1 }, { status: 201 }) }),
    )
    renderMk(FeaturedListingsPanel, { permissions: PERM })
    const select = await screen.findByLabelText('Featured promotion')
    await screen.findByRole('option', { name: /Adwoa Fabrics/ })
    fireEvent.change(select, { target: { value: '10' } })
    expect(await screen.findByRole('alert')).toHaveTextContent('open fraud case')
    expect(screen.getByRole('button', { name: 'Book the place' })).toBeDisabled()
    fireEvent.change(select, { target: { value: '9' } })
    fireEvent.click(screen.getByRole('button', { name: 'Book the place' }))
    await waitFor(() => expect(body).toEqual({ promotion_id: 9, slot_key: 'home-1', week_start: '2026-10-12', weeks: 1, category: null, position: null }))
  })

  it('shows a server conflict and hides booking and release without permission', async () => {
    server.use(http.get(`${API}/api/marketing/featured/grid/`, () => HttpResponse.json(grid(rows))))
    renderMk(FeaturedListingsPanel, { permissions: [] })
    await screen.findByText('Home · slot 1')
    expect(screen.queryByRole('button', { name: /^Release/ })).toBeNull()
    expect(screen.queryByRole('form', { name: 'Book a slot' })).toBeNull()
  })

  it('lets Marketing (deals.manage) sponsor a searched product and un-sponsor one, products only', async () => {
    const seen = []
    server.use(
      http.get(`${API}/api/marketing/featured/grid/`, () => HttpResponse.json(grid(rows))),
      http.get(`${API}/api/marketing/featured/candidates/`, () => HttpResponse.json(candidates)),
      http.get(`${API}/api/listings/sponsored/`, () => HttpResponse.json([{ id: 7, name: 'Sponsored bag', category_label: 'Bags', live: true }])),
      http.get(`${API}/api/storefront/search/`, () => HttpResponse.json({ products: [{ id: 5, kind: 'product', name: 'Kente stole', category_label: 'Fashion' }], services: [{ id: 6, kind: 'service', name: 'Kente sewing', category_label: 'Tailoring' }] })),
      http.post(`${API}/api/listings/:id/sponsored/`, async ({ request, params }) => { seen.push({ id: params.id, ...(await request.json()) }); return HttpResponse.json({}) }),
    )
    renderMk(FeaturedListingsPanel, { permissions: ['deals.manage'] })
    const now = await screen.findByRole('list', { name: 'Sponsored now' })
    expect(await within(now).findByText('Sponsored bag')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Find a product to sponsor'), { target: { value: 'kente' } })
    fireEvent.click(await screen.findByRole('button', { name: 'Mark Kente stole as sponsored' }))
    await waitFor(() => expect(seen).toEqual([{ id: '5', sponsored: true }]))
    fireEvent.click(within(now).getByRole('button', { name: 'Remove sponsored from Sponsored bag' }))
    await waitFor(() => expect(seen).toContainEqual({ id: '7', sponsored: false }))
    expect(screen.queryByText('Kente sewing')).toBeNull()
  })

  it('reads "sponsored now" from the flag, not the first 48 deals: a product outside Deals shows its true state', async () => {
    let dealsAsked = false
    server.use(
      http.get(`${API}/api/marketing/featured/grid/`, () => HttpResponse.json(grid(rows))),
      http.get(`${API}/api/marketing/featured/candidates/`, () => HttpResponse.json(candidates)),
      http.get(`${API}/api/storefront/deals/`, () => { dealsAsked = true; return HttpResponse.json([]) }),
      // Row 60 in age and not live: never in a 48-row Deals page, still flagged.
      http.get(`${API}/api/listings/sponsored/`, () => HttpResponse.json([{ id: 60, name: 'Old clay pot', category_label: 'Home', live: false }])),
      http.get(`${API}/api/storefront/search/`, () => HttpResponse.json({ products: [{ id: 60, kind: 'product', name: 'Old clay pot', category_label: 'Home' }], services: [] })),
    )
    renderMk(FeaturedListingsPanel, { permissions: ['deals.manage'] })
    const now = await screen.findByRole('list', { name: 'Sponsored now' })
    expect(await within(now).findByText('Old clay pot')).toBeInTheDocument()
    expect(within(now).getByText('Not live, so not in Deals')).toBeInTheDocument()
    expect(screen.queryByText('No product is sponsored right now.')).toBeNull()
    fireEvent.change(screen.getByLabelText('Find a product to sponsor'), { target: { value: 'clay' } })
    const results = await screen.findByRole('list', { name: 'Search results' })
    expect(await within(results).findByRole('button', { name: 'Remove sponsored from Old clay pot' })).toBeInTheDocument()
    expect(dealsAsked).toBe(false)
  })

  it('shows no sponsored section without deals.manage', async () => {
    server.use(http.get(`${API}/api/marketing/featured/grid/`, () => HttpResponse.json(grid(rows))), http.get(`${API}/api/marketing/featured/candidates/`, () => HttpResponse.json(candidates)))
    renderMk(FeaturedListingsPanel, { permissions: PERM })
    await screen.findByText(/Home featured row/)
    expect(screen.queryByText('Sponsored products')).toBeNull()
  })
})
