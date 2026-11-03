import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../../../mocks/server.js'
import CategoriesCard from '../CategoriesCard.jsx'

const MINE = 'http://localhost:8000/api/accounts/business-owners/me/categories/'
const PUBLIC = 'http://localhost:8000/api/listings/categories/'
const OPTIONS = [
  { id: 1, slug: 'electronics', label: 'Electronics', icon: '', kind: 'product' },
  { id: 2, slug: 'fashion', label: 'Fashion', icon: '', kind: 'product' },
  { id: 3, slug: 'groceries', label: 'Groceries', icon: '', kind: 'product' },
  { id: 9, slug: 'hotels', label: 'Hotels', icon: '', kind: 'service' },
]
const mine = (ids, kind = 'product') => ({
  business_kind: kind, min: 1, max: 10,
  categories: ids.map((id) => ({ id, label: OPTIONS.find((o) => o.id === id).label, kind })),
})

function serve(ids, { kind = 'product', options = OPTIONS } = {}) {
  server.use(
    http.get(MINE, () => HttpResponse.json(mine(ids, kind))),
    http.get(PUBLIC, () => HttpResponse.json(options)),
  )
}
function renderCard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}><CategoriesCard /></QueryClientProvider>)
}
const chip = (name) => screen.getByRole('button', { name: new RegExp(`^${name}`) })
const save = () => screen.getByRole('button', { name: 'Save' })

describe('CategoriesCard', () => {
  it('shows the current categories with the main one marked', async () => {
    serve([2, 1])
    renderCard()
    expect(await screen.findByText('These describe what you sell or do. You can still list in any category of your kind.')).toBeInTheDocument()
    expect(screen.getByText('Your categories')).toBeInTheDocument()
    await waitFor(() => expect(chip('Fashion')).toHaveAttribute('aria-pressed', 'true'))
    expect(chip('Electronics')).toHaveAttribute('aria-pressed', 'true')
    expect(chip('Groceries')).toHaveAttribute('aria-pressed', 'false')
    expect(within(chip('Fashion')).getByText('Main')).toBeInTheDocument()
    expect(within(chip('Electronics')).queryByText('Main')).not.toBeInTheDocument()
  })

  it('save is disabled until something changes and until at least one is selected', async () => {
    serve([1])
    renderCard()
    await waitFor(() => expect(chip('Electronics')).toHaveAttribute('aria-pressed', 'true'))
    expect(save()).toBeDisabled()
    fireEvent.click(chip('Fashion'))
    expect(save()).toBeEnabled()
    fireEvent.click(chip('Fashion'))
    expect(save()).toBeDisabled()
    fireEvent.click(chip('Electronics'))
    expect(save()).toBeDisabled()
  })

  it('adding a category and saving puts the new list in order', async () => {
    serve([1])
    let body = null
    server.use(http.put(MINE, async ({ request }) => {
      body = await request.json()
      return HttpResponse.json(mine(body.categories))
    }))
    renderCard()
    await waitFor(() => expect(chip('Electronics')).toHaveAttribute('aria-pressed', 'true'))
    fireEvent.click(chip('Groceries'))
    fireEvent.click(chip('Fashion'))
    fireEvent.click(save())
    expect(await screen.findByText('✓ Saved')).toBeInTheDocument()
    expect(body).toEqual({ categories: [1, 3, 2] })
    await waitFor(() => expect(save()).toBeDisabled())
  })

  it('make main moves a category first', async () => {
    serve([1, 2, 3])
    let body = null
    server.use(http.put(MINE, async ({ request }) => {
      body = await request.json()
      return HttpResponse.json(mine(body.categories))
    }))
    renderCard()
    await waitFor(() => expect(chip('Electronics')).toHaveAttribute('aria-pressed', 'true'))
    expect(screen.queryByRole('button', { name: 'Make Electronics main' })).not.toBeInTheDocument()
    expect(save()).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Make Groceries main' }))
    expect(within(chip('Groceries')).getByText('Main')).toBeInTheDocument()
    expect(save()).toBeEnabled()
    fireEvent.click(save())
    await screen.findByText('✓ Saved')
    expect(body).toEqual({ categories: [3, 1, 2] })
  })

  it('shows the server error and keeps the picks', async () => {
    serve([1])
    server.use(http.put(MINE, () => HttpResponse.json({ detail: 'Choose at least one category.' }, { status: 400 })))
    renderCard()
    await waitFor(() => expect(chip('Electronics')).toHaveAttribute('aria-pressed', 'true'))
    fireEvent.click(chip('Fashion'))
    fireEvent.click(save())
    expect(await screen.findByRole('alert')).toHaveTextContent('Choose at least one category.')
    expect(chip('Fashion')).toHaveAttribute('aria-pressed', 'true')
    expect(chip('Electronics')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByText('✓ Saved')).not.toBeInTheDocument()
    expect(save()).toBeEnabled()
  })

  it('without a business kind shows "Choose products or services first" instead of chips', async () => {
    serve([], { kind: null })
    renderCard()
    expect(await screen.findByText('Choose products or services first.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Electronics/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
  })

  it('never offers categories of the other kind', async () => {
    serve([9], { kind: 'service' })
    renderCard()
    await waitFor(() => expect(chip('Hotels')).toHaveAttribute('aria-pressed', 'true'))
    expect(screen.queryByRole('button', { name: /Electronics/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Fashion/ })).not.toBeInTheDocument()
  })

  it('says so when there are no categories for the kind, and when loading fails', async () => {
    serve([], { options: OPTIONS.filter((o) => o.kind === 'service') })
    const { unmount } = renderCard()
    expect(await screen.findByText(/no categories to choose from/i)).toBeInTheDocument()
    unmount()
    server.use(http.get(MINE, () => HttpResponse.json({ detail: 'x' }, { status: 500 })))
    renderCard()
    expect(await screen.findByText('Could not load your categories.')).toBeInTheDocument()
  })
})
