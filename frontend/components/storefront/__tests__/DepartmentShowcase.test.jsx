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
  it('shows a card per department with picture tiles, the icon where there is no picture, and a See all link', async () => {
    const visited = []
    server.use(
      json(HOME_FEED_URL, { most_visited: MOST_VISITED, ranked: true }),
      http.post(VISIT_URL, ({ params }) => { visited.push(params.id); return new HttpResponse(null, { status: 204 }) }),
    )
    const onNavigate = vi.fn()
    const { container } = renderWithClient(<DepartmentShowcase onNavigate={onNavigate} />)
    const electronics = await screen.findByRole('article', { name: 'Electronics' })
    expect(within(electronics).getByRole('button', { name: /Headphones/ })).toBeInTheDocument()
    expect(container.querySelector('img[src="https://cdn.test/headphones.jpg"]')).not.toBeNull()
    // A picture with resized copies loads the small one first and offers the 800 px copy to sharper screens.
    const big = container.querySelector('img[src="https://cdn.test/electronics_320.webp"]')
    expect(big).toBeNull() // electronics has sub-category tiles, so its own picture is not drawn on the card
    expect(within(electronics).getByText('🔊')).toBeInTheDocument() // Home Audio has no picture yet
    fireEvent.click(within(electronics).getByRole('button', { name: 'See all Electronics' }))
    expect(onNavigate).toHaveBeenLastCalledWith('/business?category=electronics')
    fireEvent.click(within(electronics).getByRole('button', { name: /Headphones/ }))
    expect(onNavigate).toHaveBeenLastCalledWith('/business?category=electronics-headphones')
    await waitFor(() => expect(visited).toContain('10'))
  })

  it('a department with no sub-categories is one large tile that still opens the department', async () => {
    server.use(json(HOME_FEED_URL, { most_visited: MOST_VISITED, ranked: true }))
    const onNavigate = vi.fn()
    renderWithClient(<DepartmentShowcase onNavigate={onNavigate} />)
    const books = await screen.findByRole('article', { name: 'Books' })
    fireEvent.click(within(books).getByRole('button', { name: /^Books$/ }))
    expect(onNavigate).toHaveBeenCalledWith('/business?category=books')
  })

  it('hides itself when the feed is empty or fails', async () => {
    server.use(http.get(HOME_FEED_URL, () => new HttpResponse(null, { status: 500 })))
    const { container } = renderWithClient(<DepartmentShowcase onNavigate={() => {}} />)
    await new Promise((r) => setTimeout(r, 80))
    expect(container).toBeEmptyDOMElement()
  })
})

describe('DepartmentShowcase heading', () => {
  it('says "Shop by category" unless the order really comes from visits', async () => {
    server.use(json(HOME_FEED_URL, { most_visited: MOST_VISITED, ranked: false }))
    renderWithClient(<DepartmentShowcase onNavigate={() => {}} />)
    expect(await screen.findByRole('heading', { name: 'Shop by category' })).toBeInTheDocument()
    expect(screen.queryByText('Most visited categories')).not.toBeInTheDocument()
  })

  it('says "Most visited categories" when ranked by visits', async () => {
    server.use(json(HOME_FEED_URL, { most_visited: MOST_VISITED, ranked: true }))
    renderWithClient(<DepartmentShowcase onNavigate={() => {}} />)
    expect(await screen.findByRole('heading', { name: 'Most visited categories' })).toBeInTheDocument()
  })
})

describe('DepartmentShowcase pictures', () => {
  it('a single large tile loads the resized copy with a srcset', async () => {
    const department = { ...MOST_VISITED[0], children: [] }
    server.use(json(HOME_FEED_URL, { most_visited: [department], ranked: true }))
    const { container } = renderWithClient(<DepartmentShowcase onNavigate={() => {}} />)
    await screen.findByRole('article', { name: 'Electronics' })
    const img = container.querySelector('img')
    expect(img).toHaveAttribute('src', 'https://cdn.test/electronics_320.webp')
    expect(img.getAttribute('srcset')).toBe('https://cdn.test/electronics_320.webp 320w, https://cdn.test/electronics_800.webp 800w')
  })
})
