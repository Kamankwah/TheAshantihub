import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { server } from '../../../mocks/server.js'
import CatalogueSearch from '../CatalogueSearch.jsx'

const API = 'http://localhost:8000'
const prow = (o) => ({ id: 1, brand: 'Milo', name: 'Tin 400g', barcode: '06001234567890', offer_count: 3, lowest_price: '1250.00', ...o })

function setup(responder, props = {}) {
  const seen = []
  server.use(http.get(`${API}/api/catalogue/products/`, ({ request }) => {
    seen.push(new URL(request.url).search)
    return responder ? responder() : HttpResponse.json({ results: [], truncated: false })
  }))
  render(<QueryClientProvider client={new QueryClient()}><CatalogueSearch {...props} /></QueryClientProvider>)
  return seen
}
const type = (v) => fireEvent.change(screen.getByLabelText('Product name or barcode'), { target: { value: v } })

describe('CatalogueSearch', () => {
  it('test_nothing_is_asked_until_submit', async () => {
    const seen = setup()
    type('milo')
    await new Promise((r) => setTimeout(r, 30))
    expect(seen).toEqual([])
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    expect(await screen.findByText('No catalogue product matches.')).toBeInTheDocument()
    expect(seen).toHaveLength(1)
  })

  it('test_a_typed_barcode_with_spaces_searches_by_barcode', async () => {
    const seen = setup()
    type('6001 234-567890')
    fireEvent.submit(screen.getByLabelText('Product name or barcode').closest('form'))
    await screen.findByText('No catalogue product matches.')
    expect(seen).toEqual(['?barcode=6001234567890'])
  })

  it('test_words_search_by_name', async () => {
    const seen = setup()
    type('milo tin')
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    await screen.findByText('No catalogue product matches.')
    expect(seen).toEqual(['?q=milo%20tin'])
  })

  it('test_results_show_offer_count_and_lowest_listed_price_or_none', async () => {
    setup(() => HttpResponse.json({ results: [prow(), prow({ id: 2, brand: 'Ovaltine', name: 'Jar', barcode: '', offer_count: 0, lowest_price: null })], truncated: false }))
    type('x')
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    expect(await screen.findByText('Milo Tin 400g')).toBeInTheDocument()
    expect(screen.getByText('3 live offers')).toBeInTheDocument()
    expect(screen.getByText('Lowest listed price GH₵ 1,250.00')).toBeInTheDocument()
    expect(screen.getByText('6001234567890')).toBeInTheDocument()
    expect(screen.getByText('No live offers now')).toBeInTheDocument()
  })

  it('test_truncated_results_ask_for_a_narrower_search', async () => {
    setup(() => HttpResponse.json({ results: [prow()], truncated: true }))
    type('x')
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    expect(await screen.findByText('More products matched than shown. Add a word or search by barcode.')).toBeInTheDocument()
  })

  it('test_refusal_detail_is_shown_verbatim', async () => {
    setup(() => HttpResponse.json({ detail: 'Barcode is not valid.', code: 'invalid_barcode' }, { status: 400 }))
    type('123')
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    expect(await screen.findByText('Barcode is not valid.')).toBeInTheDocument()
  })

  it('test_pick_calls_onPick_with_the_row', async () => {
    const onPick = vi.fn()
    setup(() => HttpResponse.json({ results: [prow()], truncated: false }), { onPick })
    type('milo')
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    fireEvent.click(await screen.findByRole('button', { name: 'See offers' }))
    expect(onPick).toHaveBeenCalledWith(prow())
  })

  it('test_initial_term_prefills_without_a_request_until_submit', async () => {
    const seen = setup(null, { initialTerm: 'milo' })
    expect(screen.getByLabelText('Product name or barcode')).toHaveValue('milo')
    await new Promise((r) => setTimeout(r, 30))
    expect(seen).toEqual([])
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    await screen.findByText('No catalogue product matches.')
    expect(seen).toEqual(['?q=milo'])
  })

  it('test_pick_label_labels_the_pick_button', async () => {
    setup(() => HttpResponse.json({ results: [prow()], truncated: false }), { pickLabel: 'Ask to join' })
    type('milo')
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    expect(await screen.findByRole('button', { name: 'Ask to join' })).toBeInTheDocument()
  })
})
