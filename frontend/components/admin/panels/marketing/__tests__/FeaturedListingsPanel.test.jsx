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
})
