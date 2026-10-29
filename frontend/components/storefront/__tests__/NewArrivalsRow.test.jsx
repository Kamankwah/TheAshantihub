import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { server } from '../../../mocks/server.js'
import NewArrivalsRow from '../NewArrivalsRow.jsx'

const LISTINGS_URL = 'http://localhost:8000/api/listings/'
const page = (results) => HttpResponse.json({ count: results.length, next: null, previous: null, results })

function renderRow(ui) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

describe('NewArrivalsRow', () => {
  it('shows_newest_products_and_opens_one', async () => {
    let asked = null
    server.use(http.get(LISTINGS_URL, ({ request }) => {
      asked = new URL(request.url).searchParams
      return page([
        { id: 11, name: 'Kente stole', price_amount: '120.00', effective_price: '120.00', category: { icon: '🧣' } },
        { id: 12, name: 'Shea butter', price_amount: '35.00', effective_price: '35.00', category: { icon: '🧴' } },
      ])
    }))
    const onOpen = vi.fn()
    renderRow(<NewArrivalsRow onOpen={onOpen} />)

    expect(await screen.findByRole('heading', { name: 'New arrivals' })).toBeInTheDocument()
    expect(asked.get('kind')).toBe('product')
    expect(asked.get('ordering')).toBe('-created_at')
    fireEvent.click(screen.getByText('Shea butter').closest('button'))
    expect(onOpen).toHaveBeenCalledWith(12)
  })

  it('hidden_when_there_are_no_products', async () => {
    let asked = false
    server.use(http.get(LISTINGS_URL, () => { asked = true; return page([]) }))
    const { container } = renderRow(<NewArrivalsRow onOpen={() => {}} />)
    await waitFor(() => expect(asked).toBe(true))
    await new Promise((r) => setTimeout(r, 50))
    expect(container).toBeEmptyDOMElement()
  })

  it('hidden_when_the_request_fails', async () => {
    let asked = false
    server.use(http.get(LISTINGS_URL, () => { asked = true; return new HttpResponse(null, { status: 500 }) }))
    const { container } = renderRow(<NewArrivalsRow onOpen={() => {}} />)
    await waitFor(() => expect(asked).toBe(true))
    await new Promise((r) => setTimeout(r, 50))
    expect(container).toBeEmptyDOMElement()
  })
})
