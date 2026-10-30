import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { server } from '../../../mocks/server.js'
import OwnerListingCard from './OwnerListingCard.jsx'

const API = 'http://localhost:8000'
const LISTING = {
  id: 1, name: 'Handwoven kente stole', price_amount: '250.00', stock_quantity: 11,
  status: 'published', photos: [], videos: [], variants: [], has_variants: false, pending_revision: null,
}

function renderCard(listing, props = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><OwnerListingCard listing={listing} onChanged={() => {}} {...props} /></QueryClientProvider>)
}

describe('OwnerListingCard photos', () => {
  it('shows the main photo and no empty-state when the listing only has a main photo', () => {
    renderCard({ ...LISTING, main_photo: 'https://cdn.test/stole.jpg' })
    expect(screen.getByAltText('Main photo')).toHaveAttribute('src', 'https://cdn.test/stole.jpg')
    expect(screen.queryByText(/No photos yet/)).not.toBeInTheDocument()
  })

  it('shows the empty-state when there is no main photo and no gallery photos', () => {
    renderCard({ ...LISTING, main_photo: null })
    expect(screen.getByText(/No photos yet/)).toBeInTheDocument()
  })
})

describe('OwnerListingCard live edits and approval', () => {
  it('saves only the price live through manage', async () => {
    let body = null
    server.use(http.patch(`${API}/api/listings/mine/1/manage/`, async ({ request }) => { body = await request.json(); return HttpResponse.json({}) }))
    const onChanged = vi.fn()
    let revisions = 0
    server.use(http.put(`${API}/api/listings/mine/1/revision/`, () => { revisions += 1; return HttpResponse.json({}) }))
    renderCard(LISTING, { onChanged })
    fireEvent.click(screen.getByRole('button', { name: /Edit price & specs/ }))
    expect(await screen.findByText('Live now')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Price (GHS)'), { target: { value: '260' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    expect(body).toEqual({ price_amount: '260' })
    expect(revisions).toBe(0)
  })

  it('sends edited details to the revision, not to manage, and leaves the price alone', async () => {
    let manage = 0
    let revision = null
    server.use(
      http.patch(`${API}/api/listings/mine/1/manage/`, () => { manage += 1; return HttpResponse.json({}) }),
      http.put(`${API}/api/listings/mine/1/revision/`, async ({ request }) => { revision = await request.json(); return HttpResponse.json({}) }),
    )
    const onChanged = vi.fn()
    renderCard({ ...LISTING, description: 'Old', tag: null, specs: [] }, { onChanged })
    fireEvent.click(screen.getByRole('button', { name: /Edit price & specs/ }))
    fireEvent.change(await screen.findByDisplayValue('Old'), { target: { value: 'New words' } })
    expect(screen.getByText(/needs approval/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    expect(revision).toEqual({ changes: { description: 'New words' } })
    expect(manage).toBe(0)
  })

  it('shows the changes banner from the listing', () => {
    renderCard({ ...LISTING, pending_revision: { id: 2, status: 'pending', rejection_reason: '' } })
    expect(screen.getByText(/Your approved version is live/)).toBeInTheDocument()
  })
})

describe('OwnerListingCard drop, restore and discontinue', () => {
  it('Drop asks for confirmation and says it can be reversed', async () => {
    let drops = 0
    server.use(http.post(`${API}/api/listings/mine/1/drop/`, () => { drops += 1; return HttpResponse.json({ id: 1, status: 'dropped' }) }))
    const onChanged = vi.fn()
    renderCard(LISTING, { onChanged })
    fireEvent.click(screen.getByRole('button', { name: 'Drop' }))
    expect(screen.getByText(/hides this listing from shoppers/)).toBeInTheDocument()
    expect(screen.getByText(/you can restore it later/)).toBeInTheDocument()
    expect(drops).toBe(0)
    fireEvent.click(screen.getByRole('button', { name: 'Yes, drop it' }))
    await waitFor(() => expect(drops).toBe(1))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
  })

  it('Discontinue confirmation says it is permanent and old orders still show it', async () => {
    let calls = 0
    server.use(http.post(`${API}/api/listings/mine/1/discontinue/`, () => { calls += 1; return HttpResponse.json({ id: 1, status: 'discontinued' }) }))
    renderCard(LISTING)
    fireEvent.click(screen.getByRole('button', { name: 'Discontinue' }))
    expect(screen.getByText(/Discontinue is permanent/)).toBeInTheDocument()
    expect(screen.getByText(/Old orders will still show it/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(calls).toBe(0)
    fireEvent.click(screen.getByRole('button', { name: 'Discontinue' }))
    fireEvent.click(screen.getByRole('button', { name: 'Yes, discontinue it' }))
    await waitFor(() => expect(calls).toBe(1))
  })

  it('a dropped listing shows Restore, and a refusal is shown in the server words', async () => {
    server.use(http.post(`${API}/api/listings/mine/1/restore/`, () => HttpResponse.json({ detail: 'Your plan allows 5 active listings.' }, { status: 400 })))
    renderCard({ ...LISTING, status: 'dropped' })
    expect(screen.getByText(/Dropped/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Drop' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }))
    expect(await screen.findByText('Your plan allows 5 active listings.')).toBeInTheDocument()
  })

  it('a discontinued listing has no edit or lifecycle buttons', () => {
    renderCard({ ...LISTING, status: 'discontinued' })
    expect(screen.getByText('Discontinued')).toBeInTheDocument()
    for (const name of ['Drop', 'Restore', 'Discontinue', /Edit price & specs/]) expect(screen.queryByRole('button', { name })).not.toBeInTheDocument()
  })

  it('uses basePath for the lifecycle calls', async () => {
    let hit = false
    server.use(http.post(`${API}/api/direct/listings/1/restore/`, () => { hit = true; return HttpResponse.json({}) }))
    renderCard({ ...LISTING, status: 'dropped' }, { basePath: '/api/direct/listings' })
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }))
    await waitFor(() => expect(hit).toBe(true))
  })
})


describe('OwnerListingCard decision fields', () => {
  const PRODUCT = { ...LISTING, description: 'Soft', tag: null, specs: [], has_warranty: false, warranty_details: '', has_expiry: false, expiry_date: null, return_policy: 'No returns', brand: 'Bonwire', condition: 'new', dimensions: '', weight: '', barcode: '', contact_phone: '' }

  it('sends a changed decision field to the revision, not to manage', async () => {
    let manage = 0
    let revision = null
    server.use(
      http.patch(`${API}/api/listings/mine/1/manage/`, () => { manage += 1; return HttpResponse.json({}) }),
      http.put(`${API}/api/listings/mine/1/revision/`, async ({ request }) => { revision = await request.json(); return HttpResponse.json({}) }),
    )
    const onChanged = vi.fn()
    renderCard(PRODUCT, { onChanged })
    fireEvent.click(screen.getByRole('button', { name: /Edit price & specs/ }))
    fireEvent.change(await screen.findByDisplayValue('No returns'), { target: { value: 'Returns within 7 days' } })
    fireEvent.change(screen.getByDisplayValue('Bonwire'), { target: { value: 'Adanwomase' } })
    expect(screen.queryByText('Stock quantity')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    expect(revision).toEqual({ changes: { return_policy: 'Returns within 7 days', brand: 'Adanwomase' } })
    expect(manage).toBe(0)
  })

  it('says the price was saved when the other changes were refused', async () => {
    server.use(
      http.patch(`${API}/api/listings/mine/1/manage/`, () => HttpResponse.json({})),
      http.put(`${API}/api/listings/mine/1/revision/`, () => HttpResponse.json({ detail: 'That barcode is not valid.' }, { status: 400 })),
    )
    renderCard(PRODUCT)
    fireEvent.click(screen.getByRole('button', { name: /Edit price & specs/ }))
    fireEvent.change(await screen.findByDisplayValue('Bonwire'), { target: { value: 'Other' } })
    fireEvent.change(screen.getByLabelText('Price (GHS)'), { target: { value: '300' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByText(/Price saved; the other changes were not\. That barcode is not valid\./)).toBeInTheDocument()
  })
})

describe('OwnerListingCard server stock chips', () => {
  const stockPage = (results) => ({
    count: results.length, next: null, previous: null, results, tracked_offers: 1, untracked_offers: 0,
    settings: { cover_days: 7, fallback_units: 5, window_days: 28, alerts_enabled: false, sold_out_hidden: false },
  })
  const stockRow = (o) => ({ listing_id: 1, name: 'Handwoven kente stole', stock: 2, basis: 'fallback', line: 5, low: true, sold_out: false, ...o })
  const serveStock = (results) => server.use(http.get(`${API}/api/catalogue/stock/`, () => HttpResponse.json(stockPage(results))))

  it('test_no_low_chip_from_a_count_of_three_alone', async () => {
    renderCard({ ...LISTING, stock_quantity: 3 })
    expect(await screen.findByText('3 in stock')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: /Low-stock line/ })).toBeInTheDocument())
    expect(screen.queryByText('Low stock')).not.toBeInTheDocument()
    expect(screen.queryByText(/Running low/)).not.toBeInTheDocument()
  })

  it('test_server_low_row_shows_low_stock_and_the_running_low_line', async () => {
    serveStock([stockRow({})])
    renderCard({ ...LISTING, stock_quantity: 2 })
    expect(await screen.findByText('Low stock')).toBeInTheDocument()
    expect(screen.getByText('Running low — restock soon.')).toBeInTheDocument()
    expect(screen.getByText('2 in stock')).toBeInTheDocument()
  })

  it('test_restocking_from_the_card_refreshes_the_low_stock_chip', async () => {
    let restocked = false
    server.use(
      http.get(`${API}/api/catalogue/stock/`, () => HttpResponse.json(stockPage(restocked ? [] : [stockRow({})]))),
      http.post(`${API}/api/listings/mine/1/restock/`, () => { restocked = true; return HttpResponse.json({}) }),
    )
    renderCard({ ...LISTING, stock_quantity: 2 })
    expect(await screen.findByText('Low stock')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Restock/ }))
    fireEvent.change(screen.getByPlaceholderText('Add quantity'), { target: { value: '50' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add to stock' }))
    await waitFor(() => expect(screen.queryByText('Low stock')).not.toBeInTheDocument())
  })

  it('test_server_sold_out_row_shows_sold_out', async () => {
    serveStock([stockRow({ stock: 0, low: false, sold_out: true })])
    renderCard({ ...LISTING, stock_quantity: 0 })
    expect(await screen.findByText('Sold out')).toBeInTheDocument()
    expect(screen.getByText('Sold out — restock to keep selling.')).toBeInTheDocument()
    expect(screen.queryByText('Low stock')).not.toBeInTheDocument()
  })

  it('test_uncounted_listing_says_stock_not_counted_and_has_no_line_button', async () => {
    renderCard({ ...LISTING, stock_quantity: null })
    expect(await screen.findByText('Stock not counted')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Low-stock line/ })).not.toBeInTheDocument()
  })

  it('test_line_editor_request_fires_only_when_opened', async () => {
    const lineRequests = []
    const spy = ({ request }) => { if (/\/api\/catalogue\/stock\/1\/line\//.test(request.url)) lineRequests.push(request.url) }
    server.events.on('request:start', spy)
    try {
      renderCard(LISTING)
      const toggle = await screen.findByRole('button', { name: /Low-stock line/ })
      await waitFor(() => expect(screen.getByText('11 in stock')).toBeInTheDocument())
      expect(lineRequests).toHaveLength(0)
      fireEvent.click(toggle)
      await waitFor(() => expect(lineRequests.length).toBeGreaterThan(0))
    } finally {
      server.events.removeListener('request:start', spy)
    }
  })

  it('test_direct_base_path_renders_no_catalogue_widgets', async () => {
    const catalogue = []
    const spy = ({ request }) => { if (request.url.includes('/api/catalogue/')) catalogue.push(request.url) }
    server.events.on('request:start', spy)
    try {
      renderCard(LISTING, { basePath: '/api/direct/listings' })
      expect(await screen.findByText('11 in stock')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /Low-stock line/ })).not.toBeInTheDocument()
      await new Promise((r) => setTimeout(r, 50))
      expect(catalogue).toEqual([])
    } finally {
      server.events.removeListener('request:start', spy)
    }
  })
})
