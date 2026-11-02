import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { server } from '../../../mocks/server.js'
import { HOME_FEED_URL, MOST_VISITED, VISIT_URL, json } from '../../../mocks/storefront.js'
import DepartmentShowcase from '../DepartmentShowcase.jsx'

function renderWithClient(ui) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

describe('DepartmentShowcase', () => {
  it('shows one picture tile per department, the icon where there is no picture, and no heading', async () => {
    const visited = []
    server.use(
      json(HOME_FEED_URL, { most_visited: MOST_VISITED, ranked: true }),
      http.post(VISIT_URL, ({ params }) => { visited.push(params.id); return new HttpResponse(null, { status: 204 }) }),
    )
    const onNavigate = vi.fn()
    const { container } = renderWithClient(<DepartmentShowcase onNavigate={onNavigate} />)
    const departments = await screen.findByRole('region', { name: 'Departments' })
    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
    expect(within(departments).getAllByRole('listitem')).toHaveLength(2)
    // The picture loads the small resized copy first and offers the 800 px copy to sharper screens.
    const img = container.querySelector('img')
    expect(img).toHaveAttribute('src', 'https://cdn.test/electronics_320.webp')
    expect(img.getAttribute('srcset')).toBe('https://cdn.test/electronics_320.webp 320w, https://cdn.test/electronics_800.webp 800w')
    expect(within(departments).getByText('📚')).toBeInTheDocument() // Books has no picture yet
    fireEvent.click(within(departments).getByRole('button', { name: 'Electronics' }))
    expect(onNavigate).toHaveBeenLastCalledWith('/business?category=electronics')
    await waitFor(() => expect(visited).toContain('10'))
    fireEvent.click(within(departments).getByRole('button', { name: 'Books' }))
    expect(onNavigate).toHaveBeenLastCalledWith('/business?category=books')
  })

  it('hides itself when the feed is empty or fails', async () => {
    server.use(http.get(HOME_FEED_URL, () => new HttpResponse(null, { status: 500 })))
    const { container } = renderWithClient(<DepartmentShowcase onNavigate={() => {}} />)
    await new Promise((r) => setTimeout(r, 80))
    expect(container).toBeEmptyDOMElement()
  })
})
