import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { server } from '../../../mocks/server.js'
import { HOME_FEED_URL, MOST_VISITED, VISIT_URL, json } from '../../../mocks/storefront.js'
import MostVisitedCategories from '../MostVisitedCategories.jsx'

function renderWithClient(ui) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

describe('MostVisitedCategories', () => {
  it('click_sends_visit_beacon_and_navigates', async () => {
    const visited = []
    server.use(
      json(HOME_FEED_URL, { most_visited: MOST_VISITED, ranked: true }),
      http.post(VISIT_URL, ({ params }) => { visited.push(params.id); return new HttpResponse(null, { status: 204 }) }),
    )
    const onNavigate = vi.fn()
    renderWithClient(<MostVisitedCategories onNavigate={onNavigate} />)
    expect(await screen.findByRole('heading', { name: 'Most visited categories' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Books/ }))
    expect(onNavigate).toHaveBeenCalledWith('/business?category=books')
    await waitFor(() => expect(visited).toEqual(['20']))
  })

  it('says "Shop by department", not "most visited", on the seed-order fallback', async () => {
    server.use(json(HOME_FEED_URL, { most_visited: MOST_VISITED, ranked: false }))
    renderWithClient(<MostVisitedCategories onNavigate={() => {}} />)
    expect(await screen.findByRole('heading', { name: 'Shop by department' })).toBeInTheDocument()
    expect(screen.queryByText('Most visited categories')).not.toBeInTheDocument()
  })

  it('hides itself when the feed is empty', async () => {
    let asked = false
    server.use(http.get(HOME_FEED_URL, () => { asked = true; return HttpResponse.json({ most_visited: [] }) }))
    const { container } = renderWithClient(<MostVisitedCategories onNavigate={() => {}} />)
    await waitFor(() => expect(asked).toBe(true))
    await new Promise((r) => setTimeout(r, 50))
    expect(container).toBeEmptyDOMElement()
  })
})
