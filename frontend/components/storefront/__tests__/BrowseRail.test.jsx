import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { server } from '../../../mocks/server.js'
import { TREE, TREE_URL, json } from '../../../mocks/storefront.js'
import { installMatchMedia } from '../../../test/matchMedia.js'
import BrowseRail from '../BrowseRail.jsx'

const API = 'http://localhost:8000'
const ZONES_URL = `${API}/api/listings/zones/`
const CATEGORIES_URL = `${API}/api/listings/categories/`
const KEY = 'ah-browse-rail-collapsed'
const EVENT_CATEGORIES = [
  { id: 1, slug: 'hotels', icon: '🏨', label: 'Hotels', kind: 'service' },
  { id: 7, slug: 'concerts', icon: '🎤', label: 'Concerts', kind: 'event' },
]

function railProps(extra = {}) {
  return {
    mode: 'business',
    filters: {},
    setFilters: vi.fn(),
    minPriceInput: '',
    setMinPriceInput: vi.fn(),
    maxPriceInput: '',
    setMaxPriceInput: vi.fn(),
    search: '',
    onSearchChange: vi.fn(),
    onClear: vi.fn(),
    open: false,
    onClose: vi.fn(),
    ...extra,
  }
}

function renderRail(extra = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const props = railProps(extra)
  const utils = render(<QueryClientProvider client={queryClient}><BrowseRail {...props} /></QueryClientProvider>)
  const rerender = (more) => utils.rerender(<QueryClientProvider client={queryClient}><BrowseRail {...props} {...more} /></QueryClientProvider>)
  return { ...utils, rerender, props, queryClient }
}

// All three of the rail's queries have answered.
async function settled(queryClient) {
  await waitFor(() => {
    for (const key of [['category-tree'], ['zones'], ['categories']]) {
      expect(queryClient.getQueryState(key)?.status, key[0]).toBe('success')
    }
  })
}

const rail = () => screen.getByRole('complementary')
const headings = () => within(rail()).queryAllByRole('heading', { level: 3 }).map((h) => h.textContent)
const collapsedIcons = () => within(screen.getByRole('list', { name: 'Filter sections' })).getAllByRole('button')

let storageSpies = []
beforeEach(() => { window.localStorage.clear() })
afterEach(() => {
  storageSpies.forEach((s) => s.mockRestore())
  storageSpies = []
  window.localStorage.clear()
})

describe('BrowseRail sections per context', () => {
  it('goods: Department, Customer reviews, Price, Sold by, Deals, Area', async () => {
    server.use(json(TREE_URL, TREE))
    renderRail()
    await screen.findByRole('heading', { name: 'Department' })
    await screen.findByRole('heading', { name: 'Area' })
    expect(headings()).toEqual(['Department', 'Customer reviews', 'Price', 'Sold by', 'Deals', 'Area'])
  })

  it('services (kind service): Category, Customer reviews, Price, Seller, Area', async () => {
    server.use(json(TREE_URL, TREE))
    renderRail({ filters: { kind: 'service' } })
    await screen.findByRole('heading', { name: 'Category' })
    await screen.findByRole('heading', { name: 'Area' })
    expect(headings()).toEqual(['Category', 'Customer reviews', 'Price', 'Seller', 'Area'])
  })

  it('services when the selected category is a service node and no kind is set', async () => {
    server.use(json(TREE_URL, TREE))
    renderRail({ filters: { category: 'hotels' } })
    await screen.findByRole('heading', { name: 'Seller' })
    await screen.findByRole('heading', { name: 'Area' })
    expect(headings()).toEqual(['Category', 'Customer reviews', 'Price', 'Seller', 'Area'])
  })

  it('events: Category, When, Area, and no kind switcher', async () => {
    server.use(json(CATEGORIES_URL, EVENT_CATEGORIES))
    renderRail({ mode: 'events' })
    await screen.findByRole('heading', { name: 'Category' })
    await screen.findByRole('heading', { name: 'Area' })
    expect(headings()).toEqual(['Category', 'When', 'Area'])
    expect(screen.queryByRole('radio', { name: 'Services' })).not.toBeInTheDocument()
  })

  it('no department frame and no department icon when the tree is empty', async () => {
    // The MSW default tree is [].
    const { queryClient } = renderRail()
    await settled(queryClient)
    expect(headings()).toEqual(['Customer reviews', 'Price', 'Sold by', 'Deals', 'Area'])
    fireEvent.click(screen.getByRole('button', { name: 'Collapse filters' }))
    expect(collapsedIcons().map((b) => b.getAttribute('aria-label'))).toEqual(['Customer reviews', 'Price', 'Sold by', 'Deals', 'Area'])
  })

  it('no area frame and no area icon when there are no zones', async () => {
    server.use(json(TREE_URL, TREE), json(ZONES_URL, []))
    const { queryClient } = renderRail()
    await settled(queryClient)
    expect(headings()).toEqual(['Department', 'Customer reviews', 'Price', 'Sold by', 'Deals'])
    fireEvent.click(screen.getByRole('button', { name: 'Collapse filters' }))
    expect(collapsedIcons().map((b) => b.getAttribute('aria-label'))).not.toContain('Area')
  })

  it('no event category frame when there are no event categories', async () => {
    // The MSW default categories hold no event kind.
    const { queryClient } = renderRail({ mode: 'events' })
    await settled(queryClient)
    expect(headings()).toEqual(['When', 'Area'])
  })
})

describe('BrowseRail collapse', () => {
  it('toggles 264 <-> 56 and stores the choice', async () => {
    server.use(json(TREE_URL, TREE))
    renderRail()
    await screen.findByRole('heading', { name: 'Department' })
    expect(rail().style.width).toBe('264px')
    const collapse = screen.getByRole('button', { name: 'Collapse filters' })
    expect(collapse).toHaveAttribute('aria-expanded', 'true')

    fireEvent.click(collapse)
    expect(rail().style.width).toBe('56px')
    const expand = screen.getByRole('button', { name: 'Expand filters' })
    expect(expand).toHaveAttribute('aria-expanded', 'false')
    expect(window.localStorage.getItem(KEY)).toBe('1')
    expect(headings()).toEqual([])

    fireEvent.click(expand)
    expect(rail().style.width).toBe('264px')
    expect(window.localStorage.getItem(KEY)).toBe('0')
    expect(screen.getByRole('heading', { name: 'Department' })).toBeInTheDocument()
  })

  it('a stored "1" starts collapsed, with a labelled icon per section', async () => {
    window.localStorage.setItem(KEY, '1')
    server.use(json(TREE_URL, TREE))
    renderRail()
    expect(rail().style.width).toBe('56px')
    expect(screen.getByRole('button', { name: 'Expand filters' })).toBeInTheDocument()
    await waitFor(() => expect(collapsedIcons()).toHaveLength(6))
    const icons = collapsedIcons()
    expect(icons.map((b) => b.getAttribute('aria-label'))).toEqual(['Department', 'Customer reviews', 'Price', 'Sold by', 'Deals', 'Area'])
    for (const icon of icons) {
      expect(icon).toHaveAttribute('title', icon.getAttribute('aria-label'))
      expect(icon.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    }
  })

  it('Collapse filters hands keyboard focus to Expand filters', () => {
    renderRail()
    const collapse = screen.getByRole('button', { name: 'Collapse filters' })
    collapse.focus()
    fireEvent.click(collapse)
    expect(screen.getByRole('button', { name: 'Expand filters' })).toHaveFocus()
  })

  it('Expand filters hands keyboard focus to Collapse filters', () => {
    window.localStorage.setItem(KEY, '1')
    renderRail()
    const expand = screen.getByRole('button', { name: 'Expand filters' })
    expand.focus()
    fireEvent.click(expand)
    expect(screen.getByRole('button', { name: 'Collapse filters' })).toHaveFocus()
  })

  it('a round trip through the toggle ends on Collapse filters, and an icon still lands on its heading', () => {
    renderRail()
    fireEvent.click(screen.getByRole('button', { name: 'Collapse filters' }))
    fireEvent.click(screen.getByRole('button', { name: 'Expand filters' }))
    expect(screen.getByRole('button', { name: 'Collapse filters' })).toHaveFocus()
    fireEvent.click(screen.getByRole('button', { name: 'Collapse filters' }))
    fireEvent.click(screen.getByRole('button', { name: 'Customer reviews' }))
    expect(screen.getByRole('heading', { name: 'Customer reviews' })).toHaveFocus()
  })

  it('a collapsed icon expands the rail and focuses that section heading', async () => {
    window.localStorage.setItem(KEY, '1')
    server.use(json(TREE_URL, TREE))
    renderRail()
    fireEvent.click(await screen.findByRole('button', { name: 'Price' }))
    expect(rail().style.width).toBe('264px')
    expect(screen.getByRole('heading', { name: 'Price' })).toHaveFocus()
    expect(window.localStorage.getItem(KEY)).toBe('0')
  })

  it('still renders and toggles when storage throws', async () => {
    const denied = () => { throw new Error('storage denied') }
    storageSpies = [
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(denied),
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(denied),
    ]
    // apiClient reads the session from storage too, so the fetched sections
    // may not arrive here; the rail itself must still work.
    renderRail()
    expect(storageSpies[0]).toHaveBeenCalledWith(KEY)
    expect(screen.getByRole('heading', { name: 'Customer reviews' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Collapse filters' }))
    expect(rail().style.width).toBe('56px')
    expect(storageSpies[1]).toHaveBeenCalledWith(KEY, '1')
    fireEvent.click(screen.getByRole('button', { name: 'Expand filters' }))
    expect(rail().style.width).toBe('264px')
    expect(screen.getByRole('heading', { name: 'Customer reviews' })).toBeInTheDocument()
  })

  describe('width defaults', () => {
    let mm
    afterEach(() => { mm?.restore(); mm = undefined })

    it('starts collapsed on a tablet (761-1023px) with nothing stored', () => {
      mm = installMatchMedia(900)
      renderRail()
      expect(rail().style.width).toBe('56px')
    })

    it('starts expanded at 1024px and up', () => {
      mm = installMatchMedia(1024)
      renderRail()
      expect(rail().style.width).toBe('264px')
    })

    it('a stored choice overrides the tablet default', () => {
      mm = installMatchMedia(900)
      window.localStorage.setItem(KEY, '0')
      renderRail()
      expect(rail().style.width).toBe('264px')
    })

    it('follows the window: desktop column, then a closed phone drawer, then a collapsed tablet rail', () => {
      mm = installMatchMedia(1280)
      renderRail({ open: false })
      const aside = document.querySelector('aside')
      expect(aside).not.toHaveAttribute('inert')
      expect(aside.style.position).toBe('sticky')
      act(() => mm.resize(390))
      expect(aside).toHaveAttribute('inert')
      expect(aside).toHaveAttribute('aria-hidden', 'true')
      expect(aside.style.position).toBe('fixed')
      act(() => mm.resize(900))
      expect(aside).not.toHaveAttribute('inert')
      expect(aside.style.width).toBe('56px')
    })
  })
})

describe('BrowseRail phone drawer', () => {
  let mm
  beforeEach(() => { mm = installMatchMedia(390) })
  afterEach(() => { mm.restore() })

  it('is inert and aria-hidden while closed', () => {
    renderRail({ open: false })
    const aside = document.querySelector('aside')
    expect(aside).toHaveAttribute('inert')
    expect(aside).toHaveAttribute('aria-hidden', 'true')
  })

  it('is neither inert nor aria-hidden when open, has no collapse toggle, and focuses Close', () => {
    renderRail({ open: true })
    const aside = rail()
    expect(aside).not.toHaveAttribute('inert')
    expect(aside).not.toHaveAttribute('aria-hidden')
    expect(screen.queryByRole('button', { name: 'Collapse filters' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close filters' })).toHaveFocus()
  })

  it('a stored "1" does not collapse the drawer', () => {
    window.localStorage.setItem(KEY, '1')
    renderRail({ open: true })
    expect(screen.queryByRole('button', { name: 'Expand filters' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Search in results')).toBeInTheDocument()
  })

  it('Escape, Close filters, Show results and the backdrop call onClose', () => {
    const { props } = renderRail({ open: true })
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(props.onClose).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Close filters' }))
    expect(props.onClose).toHaveBeenCalledTimes(2)
    fireEvent.click(screen.getByRole('button', { name: 'Show results' }))
    expect(props.onClose).toHaveBeenCalledTimes(3)
    fireEvent.click(document.querySelector('.ah-rail-backdrop'))
    expect(props.onClose).toHaveBeenCalledTimes(4)
  })

  it('Escape does nothing while closed', () => {
    const { props } = renderRail({ open: false })
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(props.onClose).not.toHaveBeenCalled()
  })

  it('gives focus back to the opener when it closes', () => {
    const opener = document.createElement('button')
    opener.textContent = 'Filters'
    document.body.appendChild(opener)
    opener.focus()
    const { rerender } = renderRail({ open: false })
    rerender({ open: true })
    expect(screen.getByRole('button', { name: 'Close filters' })).toHaveFocus()
    rerender({ open: false })
    expect(opener).toHaveFocus()
    opener.remove()
  })

  it('keeps focus where it is when the parent re-renders with a new onClose', () => {
    const { rerender } = renderRail({ open: true })
    const search = screen.getByLabelText('Search in results')
    search.focus()
    rerender({ open: true, onClose: vi.fn() })
    expect(search).toHaveFocus()
  })
})

describe('BrowseRail controls', () => {
  it('kind switcher: Services drops the category and the goods-only filters', () => {
    const { props } = renderRail()
    expect(screen.getByRole('radio', { name: 'All' })).toBeChecked()
    fireEvent.click(screen.getByRole('radio', { name: 'Services' }))
    expect(props.setFilters).toHaveBeenCalledTimes(1)
    const updater = props.setFilters.mock.calls[0][0]
    expect(updater({ kind: undefined, category: 'books', onSale: true, directOnly: true, zone: 'Adum' })).toStrictEqual({
      kind: 'service', category: undefined, onSale: undefined, directOnly: undefined, zone: 'Adum',
    })
  })

  it('kind switcher: Products and All clear only the category', () => {
    const { props } = renderRail({ filters: { kind: 'service' } })
    expect(screen.getByRole('radio', { name: 'Services' })).toBeChecked()
    fireEvent.click(screen.getByRole('radio', { name: 'Products' }))
    fireEvent.click(screen.getByRole('radio', { name: 'All' }))
    const [toProducts, toAll] = props.setFilters.mock.calls.map((c) => c[0])
    const sample = { kind: 'service', category: 'hotels', verified: true }
    expect(toProducts(sample)).toStrictEqual({ kind: 'product', category: undefined, verified: true })
    expect(toAll(sample)).toStrictEqual({ kind: undefined, category: undefined, verified: true })
  })

  it('Clear all filters calls onClear', () => {
    const { props } = renderRail()
    fireEvent.click(screen.getByRole('button', { name: 'Clear all filters' }))
    expect(props.onClear).toHaveBeenCalledTimes(1)
  })

  it('the search field shows search and reports typing', () => {
    const { props } = renderRail({ search: 'kente' })
    const field = screen.getByLabelText('Search in results')
    expect(field).toHaveValue('kente')
    fireEvent.change(field, { target: { value: 'kente stole' } })
    expect(props.onSearchChange).toHaveBeenCalledWith('kente stole')
  })

  it('an active section shows its own Clear, which clears only that section', async () => {
    const { props } = renderRail({ filters: { minRating: 4, zone: 'Adum' } })
    await screen.findByRole('heading', { name: 'Area' })
    expect(screen.queryByRole('button', { name: 'Clear Price' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Clear Customer reviews' }))
    expect(props.setFilters.mock.calls[0][0]({ minRating: 4, zone: 'Adum' })).toStrictEqual({ minRating: undefined, zone: 'Adum' })
    fireEvent.click(screen.getByRole('button', { name: 'Clear Area' }))
    expect(props.setFilters.mock.calls[1][0]({ minRating: 4, zone: 'Adum' })).toStrictEqual({ minRating: 4, zone: undefined })
  })

  it("clearing Price also empties App's price inputs", () => {
    const { props } = renderRail({ filters: { minPrice: 50, maxPrice: 100 }, minPriceInput: '50', maxPriceInput: '100' })
    fireEvent.click(screen.getByRole('button', { name: 'Clear Price' }))
    expect(props.setMinPriceInput).toHaveBeenCalledWith('')
    expect(props.setMaxPriceInput).toHaveBeenCalledWith('')
    expect(props.setFilters.mock.calls[0][0]({ minPrice: 50, maxPrice: 100, kind: 'product' })).toStrictEqual({ minPrice: undefined, maxPrice: undefined, kind: 'product' })
  })

  it('section headings can take focus and are labelled sections', async () => {
    server.use(json(TREE_URL, TREE))
    renderRail()
    const heading = await screen.findByRole('heading', { name: 'Department' })
    expect(heading).toHaveAttribute('tabindex', '-1')
    expect(screen.getByRole('region', { name: 'Department' })).toContainElement(heading)
  })

  describe('section bodies', () => {
    it('goods context draws the department list and the rating radios', async () => {
      server.use(json(TREE_URL, TREE))
      const { props } = renderRail()
      const department = await screen.findByRole('region', { name: 'Department' })
      expect(within(department).getByRole('button', { name: 'Electronics' })).toBeInTheDocument()
      expect(within(department).queryByRole('button', { name: 'Concerts' })).not.toBeInTheDocument()
      fireEvent.click(within(department).getByRole('button', { name: 'Books' }))
      expect(props.setFilters.mock.calls[0][0]({})).toStrictEqual({ category: 'books' })
      const reviews = screen.getByRole('region', { name: 'Customer reviews' })
      fireEvent.click(within(reviews).getByRole('radio', { name: '4 stars and up' }))
      expect(props.setFilters.mock.calls[1][0]({})).toStrictEqual({ minRating: 4 })
    })

    it('a selected leaf marks itself current inside the rail', async () => {
      server.use(json(TREE_URL, TREE))
      renderRail({ filters: { category: 'books' } })
      const department = await screen.findByRole('region', { name: 'Department' })
      await waitFor(() => expect(within(department).getByRole('button', { name: 'Books' })).toHaveAttribute('aria-current', 'true'))
    })
  })
})
