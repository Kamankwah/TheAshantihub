import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { server } from '../../../mocks/server.js'
import { STOCK_COUNT_HELP } from '../../catalogue/catalogueFormat.js'
import ListingsPanel from './ListingsPanel.jsx'
import OwnerListingCard from './OwnerListingCard.jsx'

const API = 'http://localhost:8000'
const BARCODE_PLACEHOLDER = 'Barcode on the pack (optional)'
const DRAFT = {
  id: 7, name: 'Shea butter', status: 'draft', price_amount: '20.00', price_unit: 'per item', category: 2,
  barcode: '00012345678905', photos: [], videos: [], variants: [], specs: [],
}

function mockMine(rows = []) {
  server.use(
    http.get(`${API}/api/listings/mine/`, () => HttpResponse.json(rows)),
    http.get(`${API}/api/hero/mine/`, () => HttpResponse.json({})),
  )
}
function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><ListingsPanel user={{ fullName: 'Abena' }} businessKind={null} /></QueryClientProvider>)
}
async function openCreate() {
  fireEvent.click(await screen.findByText('➕ List a New Product / Service'))
  await screen.findByText('➕ New Listing')
}
async function fillProduct() {
  await screen.findByRole('option', { name: 'Food' })
  fireEvent.change(screen.getByDisplayValue('Choose a category…'), { target: { value: '2' } })
  fireEvent.change(screen.getByDisplayValue('Choose a zone…'), { target: { value: '1' } })
  fireEvent.change(screen.getByPlaceholderText('e.g. Hand-woven Kente Scarf'), { target: { value: 'Shea butter' } })
  fireEvent.change(screen.getByPlaceholderText("Describe what you're offering — customers see this on your listing page"), { target: { value: 'Pure.' } })
  const [warranty, expiry] = screen.getAllByDisplayValue('— Please answer —')
  fireEvent.change(warranty, { target: { value: 'no' } })
  fireEvent.change(expiry, { target: { value: 'no' } })
  fireEvent.change(screen.getByPlaceholderText('e.g. Returns accepted within 7 days if unused, buyer covers transport'), { target: { value: '7-day returns.' } })
}

describe('ListingsPanel barcode', () => {
  it('test_barcode_field_only_for_goods_categories', async () => {
    mockMine()
    renderPanel()
    await openCreate()
    await screen.findByRole('option', { name: 'Food' })
    expect(screen.queryByPlaceholderText(BARCODE_PLACEHOLDER)).not.toBeInTheDocument()
    fireEvent.change(screen.getByDisplayValue('Choose a category…'), { target: { value: '1' } })
    expect(screen.queryByPlaceholderText(BARCODE_PLACEHOLDER)).not.toBeInTheDocument()
    fireEvent.change(screen.getByDisplayValue('Hotels'), { target: { value: '2' } })
    expect(screen.getByPlaceholderText(BARCODE_PLACEHOLDER)).toBeInTheDocument()
  })

  it('test_create_posts_the_barcode_as_typed', async () => {
    mockMine()
    let body = null
    server.use(http.post(`${API}/api/listings/mine/`, async ({ request }) => {
      body = await request.json()
      return HttpResponse.json({ id: 50, ...body, status: 'draft' }, { status: 201 })
    }))
    renderPanel()
    await openCreate()
    await fillProduct()
    fireEvent.change(screen.getByPlaceholderText(BARCODE_PLACEHOLDER), { target: { value: '5 000112 637922' } })
    fireEvent.click(screen.getByText('✓ Create Listing'))
    await waitFor(() => expect(body).not.toBeNull())
    expect(body.barcode).toBe('5 000112 637922')
  })

  it('test_switching_to_a_service_category_clears_the_barcode', async () => {
    mockMine()
    let body = null
    server.use(http.post(`${API}/api/listings/mine/`, async ({ request }) => {
      body = await request.json()
      return HttpResponse.json({ id: 51, ...body, status: 'draft' }, { status: 201 })
    }))
    renderPanel()
    await openCreate()
    await fillProduct()
    fireEvent.change(screen.getByPlaceholderText(BARCODE_PLACEHOLDER), { target: { value: '5000112637922' } })
    fireEvent.change(screen.getByDisplayValue('Food'), { target: { value: '1' } })
    expect(screen.queryByPlaceholderText(BARCODE_PLACEHOLDER)).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('✓ Create Listing'))
    await waitFor(() => expect(body).not.toBeNull())
    expect(body.barcode).toBe('')
  })

  it('test_barcode_error_from_the_server_sits_under_the_field', async () => {
    mockMine()
    server.use(http.post(`${API}/api/listings/mine/`, () => HttpResponse.json({ barcode: ['That barcode is not valid.'] }, { status: 400 })))
    renderPanel()
    await openCreate()
    await fillProduct()
    fireEvent.change(screen.getByPlaceholderText(BARCODE_PLACEHOLDER), { target: { value: '123' } })
    fireEvent.click(screen.getByText('✓ Create Listing'))
    const message = await screen.findByText('That barcode is not valid.')
    expect(message.parentElement).toContainElement(screen.getByPlaceholderText(BARCODE_PLACEHOLDER))
    expect(screen.getAllByText('That barcode is not valid.')).toHaveLength(1)
  })

  it('test_draft_edit_prefills_the_display_form_of_the_key', async () => {
    mockMine([DRAFT])
    let body = null
    server.use(http.patch(`${API}/api/listings/mine/7/`, async ({ request }) => { body = await request.json(); return HttpResponse.json({ id: 7 }) }))
    renderPanel()
    fireEvent.click(await screen.findByText('✏️ Edit'))
    expect(await screen.findByDisplayValue('012345678905')).toBeInTheDocument()
    expect(screen.getByText('Saved as 012345678905')).toBeInTheDocument()
    fireEvent.click(screen.getByText('✓ Save'))
    await waitFor(() => expect(body).not.toBeNull())
    expect(body.barcode).toBe('012345678905')
  })

  it('test_stock_field_says_leave_empty_if_you_do_not_count', async () => {
    mockMine()
    renderPanel()
    await openCreate()
    await fillProduct()
    // Under the Stock quantity field (the variant editor repeats it above its own stock column).
    const stockField = screen.getByText('Stock quantity').parentElement
    expect(within(stockField).getByText(STOCK_COUNT_HELP)).toBeInTheDocument()
  })

  it('test_revision_editor_sends_the_barcode_with_the_changes', async () => {
    let revision = null
    server.use(http.put(`${API}/api/listings/mine/9/revision/`, async ({ request }) => { revision = await request.json(); return HttpResponse.json({}) }))
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const listing = { id: 9, name: 'Soap', price_amount: '5.00', status: 'published', barcode: '00012345678905', photos: [], videos: [], variants: [], has_variants: false, pending_revision: null }
    const onChanged = vi.fn()
    render(<QueryClientProvider client={client}><OwnerListingCard listing={listing} onChanged={onChanged} /></QueryClientProvider>)
    fireEvent.click(screen.getByRole('button', { name: /Edit price & specs/ }))
    const input = await screen.findByDisplayValue('012345678905')
    fireEvent.change(input, { target: { value: '5000112637922' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    expect(revision).toEqual({ changes: { barcode: '5000112637922' } })
  })
})
