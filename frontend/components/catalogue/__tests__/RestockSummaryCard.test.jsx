import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { server } from '../../../mocks/server.js'
import RestockSummaryCard from '../RestockSummaryCard.jsx'

const API = 'http://localhost:8000'
const S = { cover_days: 7, fallback_units: 5, window_days: 28, alerts_enabled: false, sold_out_hidden: false }
const body = (count) => ({ count, next: null, previous: null, results: [], tracked_offers: 3, untracked_offers: 0, settings: S })

let queryClient

function setup(count, onOpen = vi.fn()) {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  server.use(http.get(`${API}/api/catalogue/stock/`, () => HttpResponse.json(body(count))))
  render(<QueryClientProvider client={queryClient}><RestockSummaryCard onOpen={onOpen} /></QueryClientProvider>)
  return onOpen
}

describe('RestockSummaryCard', () => {
  it('test_shows_the_count_and_calls_onOpen', async () => {
    const onOpen = setup(3)
    expect(await screen.findByText('3 products need restocking')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'See what needs restocking' }))
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('says "product" for one', async () => {
    setup(1)
    expect(await screen.findByText('1 product needs restocking')).toBeInTheDocument()
  })

  it('test_renders_nothing_when_nothing_is_low', async () => {
    setup(0)
    await waitFor(() => expect(queryClient.getQueryState(['catalogue-stock', 'list'])?.status).toBe('success'))
    expect(screen.queryByRole('button', { name: 'See what needs restocking' })).not.toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/restocking/)
  })
})
