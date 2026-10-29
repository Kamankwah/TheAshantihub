// Conformance contract for the catalogue screens (Plan 6F). Add every new catalogue screen here
// (OtherSellersPanel is covered by its own test below). Checks what no screen may ever show or link.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, describe, expect, it } from 'vitest'
import { server } from '../../../mocks/server.js'
import { C } from '../../../theme.js'
import { D } from '../../dashboard/theme.js'
import OtherSellersPanel from '../../shop/OtherSellersPanel.jsx'
import CatalogueQueuePanel from '../../admin/panels/CatalogueQueuePanel.jsx'
import GroupingCard from '../GroupingCard.jsx'
import NeedsRestockingPanel from '../NeedsRestockingPanel.jsx'
import ProductLookupPanel from '../ProductLookupPanel.jsx'
import StockLineEditor from '../StockLineEditor.jsx'

const API = 'http://localhost:8000'
const settings = { cover_days: 7, fallback_units: 5, window_days: 28, alerts_enabled: false, sold_out_hidden: false }
const cover = { listing_id: 5, name: 'Rice', stock: 4, units_sold: 14, days_on_sale: 14, days_of_cover: '2.0', basis: 'sales', line: 6, low: true, sold_out: false }
const product = { id: 1, brand: 'Milo', name: 'Tin 400g', barcode: '06001234567890', offer_count: 2, lowest_price: '1250.00' }
const offer = (o) => ({
  listing_id: 11, name: 'Milo', price_amount: '1300.00', price_now: '1250.00', price_basis: 'discount', price_unit: 'per tin',
  condition: 'new', business_name: 'Kofi Stores', verified: true, zone: 'Adum', available_quantity: 7, ...o,
})
const reqRow = {
  id: 1, status: 'pending', source: 'vendor', brand: 'Nestle', name: 'Milo 400g', barcode: '6001068011001',
  catalogue_product: null, rejection_reason: '', created_at: '2026-10-20T08:00:00Z', reviewed_at: null, reviewed_by_name: null, matches: [],
  listing: { id: 21, name: 'Milo tin', brand: 'Nestle', barcode: '06001068011001', status: 'published', price_amount: '45.00', business_name: 'Akosua Ntoma Store', business_suspended: false, grouped_with: null },
}
const groupState = (request, catalogue_product = null) => ({ listing: 7, groupable: true, barcode: '', store_code: false, catalogue_product, request })
const gReq = (o) => ({ id: 31, status: 'pending', source: 'vendor', catalogue_product: null, brand: 'Milo', name: 'Tin 400g', barcode: '', rejection_reason: '', ...o })

const wrap = (ui) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>

function mockAll(groupingState) {
  server.use(
    http.get(`${API}/api/catalogue/stock/`, () => HttpResponse.json({
      count: 2, next: null, previous: null, tracked_offers: 3, untracked_offers: 1, settings,
      results: [{ ...cover, listing_id: 2, name: 'Zinc', stock: 0, sold_out: true, low: true }, cover],
    })),
    http.get(`${API}/api/catalogue/stock/5/line/`, () => HttpResponse.json({ listing_id: 5, line: 6, cover })),
    http.get(`${API}/api/listings/mine/`, () => HttpResponse.json([{ id: 4, name: 'My Milo' }])),
    http.get(`${API}/api/catalogue/mine/7/`, () => HttpResponse.json(groupingState)),
    http.get(`${API}/api/catalogue/products/`, () => HttpResponse.json({ results: [product], truncated: true })),
    http.get(`${API}/api/catalogue/products/:id/offers/`, () => HttpResponse.json({
      catalogue_product: product, your_listings: [4], truncated: true,
      offers: [offer(), offer({ listing_id: 12, business_name: null, available_quantity: null, price_basis: 'regular', price_now: '1300.00' })],
    })),
    http.get(`${API}/api/catalogue/staff/requests/pending/`, ({ request }) => HttpResponse.json(
      new URL(request.url).searchParams.get('status') === 'pending'
        ? { count: 1, next: null, previous: null, results: [reqRow] }
        : { count: 0, next: null, previous: null, results: [] },
    )),
  )
}

async function renderScreens(groupingState) {
  mockAll(groupingState)
  const r = render(wrap(<>
    <NeedsRestockingPanel />
    <StockLineEditor listingId={5} />
    <GroupingCard listing={{ id: 7, brand: 'Milo', name: 'Tin 400g' }} />
    <ProductLookupPanel />
    <CatalogueQueuePanel />
  </>))
  await screen.findByText('Zinc')
  fireEvent.click(screen.getByRole('button', { name: /Other sellers of this product/ }))
  fireEvent.change(screen.getByLabelText('Product name or barcode'), { target: { value: 'milo' } })
  fireEvent.click(screen.getAllByRole('button', { name: 'Search' })[0])
  fireEvent.click(await screen.findByRole('button', { name: 'See offers' }))
  await screen.findByText('Kofi Stores')
  await screen.findByText(/Akosua Ntoma Store/)
  await screen.findByText('Your alert line: 6 units')
  return r
}

// own text only, so a parent does not repeat a child's text
const ownText = (el) => [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('')

function sweep(container) {
  const text = document.body.textContent
  expect(container.querySelectorAll('a[href^="tel:"], a[href^="mailto:"], a[href*="wa.me"]')).toHaveLength(0)
  expect(container.innerHTML).not.toMatch(/wa\.me/)
  expect(text).not.toMatch(/\bkm\b|metres|away/i)
  expect(text).not.toMatch(/NaN|undefined|null/)
  expect(text).not.toContain('Not yet verified')

  const prices = [...container.querySelectorAll('*')].filter((el) => /GH₵\s?[\d,]+/.test(ownText(el)))
  expect(prices.length).toBeGreaterThan(0)
  for (const el of prices) expect(el.style.fontVariantNumeric, el.outerHTML).toBe('tabular-nums')

  // Gold is for fills (buttons, chips); a price or the verified mark is never gold.
  const gold = (el) => {
    const h = el.outerHTML.toLowerCase()
    return /d4a017/.test(h) || /rgb\(\s*212,\s*160,\s*23\s*\)/.test(h) || (D.gold && h.includes(String(D.gold).toLowerCase()))
  }
  for (const el of prices) expect(gold(el), el.outerHTML).toBeFalsy()

  const verified = [...container.querySelectorAll('*')].filter((el) => ownText(el).includes('Verified business'))
  expect(verified.length).toBeGreaterThan(0)
  for (const el of verified) {
    expect(D.green).toMatch(/^var\(--ah-green(, #006400)?\)$/i)
    expect(el.style.color).toBe(D.green)
    expect(gold(el), el.outerHTML).toBeFalsy()
  }
}

afterEach(cleanup)

describe('CatalogueNoInventionSweep', { timeout: 20000 }, () => {
  it('test_grouped_state_screens_invent_nothing', async () => {
    const { container } = await renderScreens(groupState(null, { id: 4, brand: 'Milo', name: 'Tin 400g', barcode: '' }))
    await screen.findByText(/Only AshantiHub can ungroup it/)
    sweep(container)
  })

  it('test_waiting_state_screens_invent_nothing', async () => {
    const { container } = await renderScreens(groupState(gReq({ status: 'pending' })))
    sweep(container)
  })

  it('test_rejected_state_screens_invent_nothing', async () => {
    const { container } = await renderScreens(groupState(gReq({ status: 'rejected', rejection_reason: 'Different size' })))
    await screen.findByText(/Different size/)
    sweep(container)
  })

  it('test_other_sellers_panel_invents_nothing', async () => {
    server.use(http.get(`${API}/api/catalogue/listings/:id/other-sellers/`, () => HttpResponse.json({
      catalogue_product: product, featured_offer_id: 11, ordering: 'price',
      offers: [offer(), offer({ listing_id: 12, business_name: 'Ama Shop', verified: false, available_quantity: null, price_now: '1300.00' })],
    })))
    const { container } = render(wrap(<OtherSellersPanel listingId={5} user={{ accountType: 'customer', id: 1 }} onAddToCart={() => {}} onOpenListing={() => {}} />))
    await screen.findByText('Kofi Stores')
    await screen.findByText('Ama Shop')
    const text = document.body.textContent
    expect(container.querySelectorAll('a[href^="tel:"], a[href^="mailto:"], a[href*="wa.me"]')).toHaveLength(0)
    expect(container.innerHTML).not.toMatch(/wa\.me/)
    expect(text).not.toMatch(/\bkm\b|metres|away/i)
    expect(text).not.toMatch(/NaN|undefined|null/)
    expect(text).not.toContain('Not yet verified')

    const gold = (el) => {
      const h = el.outerHTML.toLowerCase()
      return /d4a017/.test(h) || /rgb\(\s*212,\s*160,\s*23\s*\)/.test(h) || (C.gold && h.includes(String(C.gold).toLowerCase()))
    }
    const prices = [...container.querySelectorAll('*')].filter((el) => /GH₵\s?[\d,]+/.test(ownText(el)))
    expect(prices.length).toBe(2)
    for (const el of prices) {
      expect(el.style.fontVariantNumeric, el.outerHTML).toBe('tabular-nums')
      expect(gold(el), el.outerHTML).toBeFalsy()
    }
    const featured = screen.getByText('Best price from a verified business')
    expect(gold(featured)).toBeFalsy()
    // Only the verified row carries the mark, in the shared VerifiedMark colours (not gold).
    const marks = screen.getAllByRole('img', { name: 'Verified business' })
    expect(marks).toHaveLength(1)
    expect(marks[0].style.color).toBe(C.okInk)
    expect(gold(marks[0])).toBeFalsy()
  })
})
