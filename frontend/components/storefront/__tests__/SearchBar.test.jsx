import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { server } from '../../../mocks/server.js'
import { SEARCH_URL, TREE, TREE_URL, json } from '../../../mocks/storefront.js'
import SearchBar from '../SearchBar.jsx'

function renderWithClient(ui) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

const row = (id, kind, name) => ({ id, kind, name, price: '25.00', photo: null, category_label: 'Things' })

function recordSearches(body) {
  const seen = []
  server.use(http.get(SEARCH_URL, ({ request }) => {
    const url = new URL(request.url)
    seen.push({ q: url.searchParams.get('q'), category: url.searchParams.get('category') })
    return HttpResponse.json(body)
  }))
  return seen
}

describe('SearchBar', () => {
  it('debounces_and_groups_four_kinds', async () => {
    server.use(json(TREE_URL, TREE))
    const seen = recordSearches({
      products: [row(1, 'product', 'Chocolate cake')],
      services: [row(2, 'service', 'Cake decorating class')],
      stays: [row(3, 'stay', 'Cake House Lodge')],
      events: [row(4, 'event', 'Cake festival')],
    })
    const onOpenResult = vi.fn()
    renderWithClient(<SearchBar onOpenResult={onOpenResult} onSubmit={() => {}} />)
    const input = screen.getByRole('searchbox', { name: 'Search AshantiHub' })
    fireEvent.change(input, { target: { value: 'c' } })
    fireEvent.change(input, { target: { value: 'ca' } })
    fireEvent.change(input, { target: { value: 'cak' } })
    const results = await screen.findByRole('region', { name: 'Search results' })
    await within(results).findByText('Chocolate cake')
    expect(seen.map((s) => s.q)).toEqual(['cak'])
    for (const heading of ['Products', 'Services', 'Stays', 'Events']) {
      expect(within(results).getByText(heading)).toBeInTheDocument()
    }
    fireEvent.click(within(results).getByText('Cake festival'))
    expect(onOpenResult).toHaveBeenCalledWith(expect.objectContaining({ id: 4, kind: 'event' }))
  })

  it('category_picker_filters_request', async () => {
    server.use(json(TREE_URL, TREE))
    const seen = recordSearches({ products: [row(1, 'product', 'Phone case')], services: [], stays: [], events: [] })
    renderWithClient(<SearchBar onOpenResult={() => {}} onSubmit={() => {}} />)
    const picker = screen.getByRole('combobox', { name: 'Search in' })
    await screen.findByRole('option', { name: 'Electronics' })
    fireEvent.change(picker, { target: { value: 'electronics' } })
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search AshantiHub' }), { target: { value: 'phone' } })
    await screen.findByText('Phone case')
    expect(seen.at(-1)).toEqual({ q: 'phone', category: 'electronics' })
    // Only the products group came back, so only its heading shows.
    expect(screen.queryByText('Services')).not.toBeInTheDocument()
  })

  it('empty_results_say_nothing_found', async () => {
    recordSearches({ products: [], services: [], stays: [], events: [] })
    renderWithClient(<SearchBar onOpenResult={() => {}} onSubmit={() => {}} />)
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search AshantiHub' }), { target: { value: 'zzz' } })
    expect(await screen.findByText('Nothing found for “zzz”.')).toBeInTheDocument()
  })

  it('submit hands the query and the picked department to onSubmit', async () => {
    server.use(json(TREE_URL, TREE))
    recordSearches({ products: [], services: [], stays: [], events: [] })
    const onSubmit = vi.fn()
    renderWithClient(<SearchBar onOpenResult={() => {}} onSubmit={onSubmit} />)
    await screen.findByRole('option', { name: 'Books' })
    fireEvent.change(screen.getByRole('combobox', { name: 'Search in' }), { target: { value: 'books' } })
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search AshantiHub' }), { target: { value: 'novels' } })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    expect(onSubmit).toHaveBeenCalledWith({ q: 'novels', category: 'books' })
  })

  it('asks nothing for fewer than two characters', async () => {
    const seen = recordSearches({ products: [], services: [], stays: [], events: [] })
    renderWithClient(<SearchBar onOpenResult={() => {}} onSubmit={() => {}} />)
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search AshantiHub' }), { target: { value: 'k' } })
    await new Promise((r) => setTimeout(r, 450))
    expect(seen).toEqual([])
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Search results' })).not.toBeInTheDocument())
  })
})
