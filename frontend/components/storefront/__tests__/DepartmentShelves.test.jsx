import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { server } from '../../../mocks/server.js'
import { HOME_FEED_URL, MOST_VISITED, json } from '../../../mocks/storefront.js'
import DepartmentShelves from '../DepartmentShelves.jsx'

const LISTINGS = 'http://localhost:8000/api/listings/'
const item = (id, name) => ({ id, name, price_amount: '10.00', effective_price: '10.00', main_photo: null, category: { icon: '📚' }, review_count: 0, avg_rating: null })

function renderWithClient(ui) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

describe('DepartmentShelves', () => {
  it('shows each department\'s newest products with a See all link, and skips a department with none', async () => {
    const asked = []
    server.use(
      json(HOME_FEED_URL, { most_visited: MOST_VISITED, ranked: true }),
      http.get(LISTINGS, ({ request }) => {
        const params = new URL(request.url).searchParams
        asked.push([params.get('category'), params.get('kind'), params.get('ordering')])
        return HttpResponse.json({ next: null, results: params.get('category') === 'books' ? [item(1, 'Kente handbook')] : [] })
      }),
    )
    const onNavigate = vi.fn()
    const onOpen = vi.fn()
    renderWithClient(<DepartmentShelves onNavigate={onNavigate} onOpen={onOpen} />)
    const shelf = await screen.findByRole('region', { name: 'Books' })
    expect(within(shelf).getByRole('heading', { name: 'Books' })).toBeInTheDocument()
    fireEvent.click(within(shelf).getByRole('button', { name: /Kente handbook/ }))
    expect(onOpen).toHaveBeenCalledWith(1)
    fireEvent.click(within(shelf).getByRole('button', { name: 'See all Books' }))
    expect(onNavigate).toHaveBeenCalledWith('/business?category=books')
    await waitFor(() => expect(asked).toContainEqual(['electronics', 'product', '-created_at']))
    expect(screen.queryByRole('region', { name: 'Electronics' })).toBeNull()
  })

  it('renders nothing while the feed is empty', async () => {
    const { container } = renderWithClient(<DepartmentShelves onNavigate={() => {}} onOpen={() => {}} />)
    await new Promise((r) => setTimeout(r, 80))
    expect(container).toBeEmptyDOMElement()
  })
})
