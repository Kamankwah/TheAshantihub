import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import DepartmentSection from '../DepartmentSection.jsx'

const leaf = (id, slug, label, kind = 'product') => ({ id, slug, label, icon: '', kind, children: [] })
const TREE = [
  {
    id: 1, slug: 'electronics', label: 'Electronics', kind: 'product',
    children: [
      { id: 2, slug: 'phones', label: 'Phones', kind: 'product', children: [leaf(3, 'phone-cases', 'Cases'), leaf(4, 'chargers', 'Chargers')] },
      leaf(5, 'audio', 'Audio'),
    ],
  },
  leaf(6, 'books', 'Books'),
  leaf(7, 'hotels', 'Hotels', 'service'),
]
const NODES = TREE

function setup(filters = {}, nodes = NODES) {
  const setFilters = vi.fn()
  render(<DepartmentSection tree={TREE} nodes={nodes} filters={filters} setFilters={setFilters} />)
  const applied = (n = 0, state = filters) => setFilters.mock.calls[n][0](state)
  return { setFilters, applied }
}
const names = () => screen.getAllByRole('button').map((b) => b.textContent)

describe('DepartmentSection', () => {
  it('renders nothing without department nodes', () => {
    const { container } = render(<DepartmentSection tree={[]} nodes={[]} filters={{}} setFilters={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('with no category lists the top-level departments and no back link', () => {
    const { applied } = setup({})
    expect(names()).toEqual(['Electronics', 'Books', 'Hotels'])
    fireEvent.click(screen.getByRole('button', { name: 'Books' }))
    expect(applied()).toStrictEqual({ category: 'books' })
  })

  it('a selected top-level node with children shows All departments, the node, then its children', () => {
    const { applied } = setup({ category: 'electronics' })
    expect(names()).toEqual(['‹ All departments', 'Electronics', 'Phones', 'Audio'])
    expect(screen.getByRole('button', { name: 'Electronics' })).toHaveAttribute('aria-current', 'true')
    expect(screen.getByRole('button', { name: 'Phones' })).not.toHaveAttribute('aria-current')
    fireEvent.click(screen.getByRole('button', { name: '‹ All departments' }))
    expect(applied(0, { category: 'electronics', zone: 'Adum' })).toStrictEqual({ category: undefined, zone: 'Adum' })
    fireEvent.click(screen.getByRole('button', { name: 'Phones' }))
    expect(applied(1)).toStrictEqual({ category: 'phones' })
  })

  it('a selected nested node with children backs up to its parent', () => {
    const { applied } = setup({ category: 'phones' })
    expect(names()).toEqual(['‹ Electronics', 'Phones', 'Cases', 'Chargers'])
    fireEvent.click(screen.getByRole('button', { name: '‹ Electronics' }))
    expect(applied()).toStrictEqual({ category: 'electronics' })
  })

  it('a nested leaf shows a back link to its grandparent, the parent label, then its siblings', () => {
    const { applied } = setup({ category: 'phone-cases' })
    expect(names()).toEqual(['‹ Electronics', 'Cases', 'Chargers'])
    expect(screen.getByText('Phones')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cases' })).toHaveAttribute('aria-current', 'true')
    expect(screen.getByRole('button', { name: 'Chargers' })).not.toHaveAttribute('aria-current')
    fireEvent.click(screen.getByRole('button', { name: '‹ Electronics' }))
    expect(applied()).toStrictEqual({ category: 'electronics' })
  })

  it('a second-level leaf under a top-level node backs up to All departments', () => {
    const { applied } = setup({ category: 'audio' })
    expect(names()).toEqual(['‹ All departments', 'Phones', 'Audio'])
    expect(screen.getByText('Electronics')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Audio' })).toHaveAttribute('aria-current', 'true')
    fireEvent.click(screen.getByRole('button', { name: '‹ All departments' }))
    expect(applied()).toStrictEqual({ category: undefined })
  })

  it('a top-level leaf shows All departments and the top-level list with it marked', () => {
    setup({ category: 'books' })
    expect(names()).toEqual(['‹ All departments', 'Electronics', 'Books', 'Hotels'])
    expect(screen.getByRole('button', { name: 'Books' })).toHaveAttribute('aria-current', 'true')
  })

  it('an unknown slug falls back to the top-level list with an All departments link that clears it', () => {
    const { applied } = setup({ category: 'gone' })
    expect(names()).toEqual(['‹ All departments', 'Electronics', 'Books', 'Hotels'])
    expect(screen.queryByRole('button', { current: true })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '‹ All departments' }))
    expect(applied()).toStrictEqual({ category: undefined })
  })

  it('picking a node of another kind clears kind, and a service also drops goods-only filters', () => {
    const { applied } = setup({ kind: 'product', onSale: true })
    fireEvent.click(screen.getByRole('button', { name: 'Hotels' }))
    expect(applied(0, { kind: 'product', onSale: true, directOnly: true })).toStrictEqual({
      kind: undefined, category: 'hotels', onSale: undefined, directOnly: undefined,
    })
  })

  it('the list is a labelled navigation of buttons', () => {
    setup({})
    expect(within(screen.getByRole('navigation', { name: 'Department' })).getAllByRole('button')).toHaveLength(3)
  })
})
