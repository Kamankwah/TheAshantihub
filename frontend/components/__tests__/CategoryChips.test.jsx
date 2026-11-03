import { useState } from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import CategoryChips from '../CategoryChips.jsx'
import { C } from '../../theme.js'

const OPTIONS = [
  { id: 1, label: 'Electronics' },
  { id: 2, label: 'Fashion' },
  { id: 3, label: 'Groceries' },
  { id: 4, label: 'Furniture' },
]

function Harness({ initial = [], max, disabled, categories = OPTIONS, all, onValue }) {
  const [value, setValue] = useState(initial)
  return (
    <CategoryChips
      label="Categories"
      categories={categories}
      all={all}
      value={value}
      max={max}
      disabled={disabled}
      onChange={(next) => { setValue(next); onValue?.(next) }}
    />
  )
}

describe('CategoryChips', () => {
  it('toggles a category on and off', () => {
    const seen = []
    render(<Harness onValue={(v) => seen.push(v)} />)
    const fashion = screen.getByRole('button', { name: /Fashion/ })
    expect(fashion).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(fashion)
    expect(fashion).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: /Electronics/ }))
    expect(seen).toEqual([[2], [2, 1]])
    fireEvent.click(fashion)
    expect(fashion).toHaveAttribute('aria-pressed', 'false')
    expect(seen[2]).toEqual([1])
  })

  it('the first selected shows the Main tag and removing it promotes the next', () => {
    render(<Harness initial={[3, 1]} />)
    expect(screen.getAllByText('Main')).toHaveLength(1)
    expect(screen.getByRole('button', { name: /Groceries/ })).toHaveTextContent('Main')
    expect(screen.getByRole('button', { name: /Electronics/ })).not.toHaveTextContent('Main')
    fireEvent.click(screen.getByRole('button', { name: /Groceries/ }))
    expect(screen.getAllByText('Main')).toHaveLength(1)
    expect(screen.getByRole('button', { name: /Electronics/ })).toHaveTextContent('Main')
  })

  it('stops at max and shows the hint', () => {
    const seen = []
    render(<Harness initial={[1, 2]} max={2} onValue={(v) => seen.push(v)} />)
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
    fireEvent.click(screen.getByRole('button', { name: /Groceries/ }))
    expect(seen).toEqual([])
    expect(screen.getByRole('status')).toHaveTextContent('You can choose up to 2')
    expect(screen.getByRole('button', { name: /Groceries/ })).toHaveAttribute('aria-pressed', 'false')
    // a selected chip can still be removed at the limit, and the hint goes away
    fireEvent.click(screen.getByRole('button', { name: /Fashion/ }))
    expect(seen).toEqual([[1]])
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
  })

  it('exposes aria-pressed and chips are native focusable buttons', () => {
    render(<Harness />)
    const group = screen.getByRole('group', { name: 'Categories' })
    expect(group).toBeInTheDocument()
    // Native buttons: focusable in tab order, no tabindex tricks, Enter/Space fire the click.
    const buttons = screen.getAllByRole('button')
    buttons.forEach((b) => {
      expect(b.tagName).toBe('BUTTON')
      expect(b).toHaveAttribute('type', 'button')
      expect(b).not.toHaveAttribute('tabindex', '-1')
    })
    buttons[0].focus()
    expect(buttons[0]).toHaveFocus()
    fireEvent.click(buttons[0])
    expect(buttons[0]).toHaveAttribute('aria-pressed', 'true')
    expect(buttons[0]).toHaveFocus()
  })

  it('renders nothing selectable when disabled', () => {
    const seen = []
    const { unmount } = render(<Harness initial={[1]} disabled onValue={(v) => seen.push(v)} />)
    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(OPTIONS.length)
    buttons.forEach((b) => expect(b).toBeDisabled())
    fireEvent.click(buttons[1])
    expect(seen).toEqual([])
    unmount()

    render(<Harness categories={[]} />)
    expect(screen.queryAllByRole('button')).toHaveLength(0)
    expect(screen.getByText('Categories')).toBeInTheDocument()
  })

  it('selected chip text uses the theme ink token, not a fixed brown', () => {
    render(<Harness initial={[2]} />)
    const on = screen.getByRole('button', { name: /Fashion/ })
    const off = screen.getByRole('button', { name: /Electronics/ })
    expect(on.style.color).toBe(C.ink)
    expect(on.style.color).not.toBe(C.darkBrown)
    expect(off.style.color).toBe(C.ink)
  })

  it('ignores a stale id: it neither counts toward max nor hides the Main tag', () => {
    const seen = []
    render(<Harness initial={[99, 2]} max={2} onValue={(v) => seen.push(v)} />)
    expect(screen.getByRole('button', { name: /Fashion/ })).toHaveTextContent('Main')
    fireEvent.click(screen.getByRole('button', { name: /Groceries/ }))
    expect(seen).toEqual([[2, 3]])
  })

  it('counts a duplicate id once and emits a cleaned list', () => {
    const seen = []
    render(<Harness initial={[2, 2, 99]} max={2} onValue={(v) => seen.push(v)} />)
    expect(screen.getAllByText('Main')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: /Electronics/ }))
    expect(seen).toEqual([[2, 1]])
    fireEvent.click(screen.getByRole('button', { name: /Fashion/ }))
    expect(seen[1]).toEqual([1])
  })
})

// The product list is a department tree (~270 rows) whose sub-category labels repeat across departments (ruling R34).
const TREE = [
  { id: 100, label: 'Electronics', icon: '📱', kind: 'product', parent: null },
  { id: 101, label: 'Accessories', kind: 'product', parent: 100 },
  { id: 102, label: 'Headphones', kind: 'product', parent: 100 },
  { id: 200, label: 'Clothing', icon: '👗', kind: 'product', parent: null },
  { id: 201, label: 'Accessories', kind: 'product', parent: 200 },
  { id: 202, label: 'Shoes', kind: 'product', parent: 200 },
  { id: 300, label: 'Jewelry', icon: '💍', kind: 'product', parent: null },
  { id: 301, label: 'Accessories', kind: 'product', parent: 300 },
  { id: 302, label: 'Watches', kind: 'product', parent: 300 },
]
// More than 24 options: the search box appears.
const BIG = [...TREE, ...Array.from({ length: 20 }, (_, i) => ({ id: 400 + i, label: `Gadget ${i + 1}`, kind: 'product', parent: 100 }))]

const sectionHeader = (dept) => screen.getAllByRole('button').find((b) => b.hasAttribute('aria-expanded') && b.textContent.includes(dept))
const section = (dept) => screen.getByRole('group', { name: new RegExp(dept) })

describe('CategoryChips — department sections', () => {
  it('groups a department tree into sections that start collapsed, with no search box for a short list', () => {
    render(<Harness categories={TREE} all={TREE} />)
    const headers = screen.getAllByRole('button', { expanded: false })
    expect(headers.map((b) => b.textContent)).toEqual(['▸📱 Electronics', '▸👗 Clothing', '▸💍 Jewelry'])
    expect(screen.queryAllByRole('button', { pressed: false })).toHaveLength(0)
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
    expect(screen.queryByText(/^Selected:/)).not.toBeInTheDocument()
  })

  it('opens a section from its header and names chips by their short label', () => {
    render(<Harness categories={TREE} all={TREE} />)
    fireEvent.click(sectionHeader('Clothing'))
    expect(sectionHeader('Clothing')).toHaveAttribute('aria-expanded', 'true')
    const chips = within(section('Clothing')).getAllByRole('button')
    expect(chips.map((b) => b.textContent)).toEqual(['Clothing — general', 'Accessories', 'Shoes'])
    expect(sectionHeader('Electronics')).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(sectionHeader('Clothing'))
    expect(sectionHeader('Clothing')).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('group', { name: /Clothing/ })).not.toBeInTheDocument()
  })

  it('a section holding a selected category starts open and its header counts the picks', () => {
    render(<Harness categories={TREE} all={TREE} initial={[302, 101, 300]} />)
    expect(sectionHeader('Electronics')).toHaveAttribute('aria-expanded', 'true')
    expect(sectionHeader('Jewelry')).toHaveAttribute('aria-expanded', 'true')
    expect(sectionHeader('Clothing')).toHaveAttribute('aria-expanded', 'false')
    expect(sectionHeader('Jewelry')).toHaveTextContent('2 selected')
    expect(sectionHeader('Electronics')).toHaveTextContent('1 selected')
    expect(sectionHeader('Clothing')).not.toHaveTextContent('selected')
    expect(within(section('Jewelry')).getByRole('button', { name: /^Watches/ })).toHaveTextContent('Main')
  })

  it('opens a section when a category in it becomes selected from outside', () => {
    const { rerender } = render(<CategoryChips label="Categories" categories={TREE} all={TREE} value={[]} onChange={() => {}} />)
    expect(sectionHeader('Clothing')).toHaveAttribute('aria-expanded', 'false')
    rerender(<CategoryChips label="Categories" categories={TREE} all={TREE} value={[202]} onChange={() => {}} />)
    expect(sectionHeader('Clothing')).toHaveAttribute('aria-expanded', 'true')
    expect(within(section('Clothing')).getByRole('button', { name: /^Shoes/ })).toHaveAttribute('aria-pressed', 'true')
  })

  it('toggling inside a section picks and unpicks, and the section stays open after its last pick goes', () => {
    const seen = []
    render(<Harness categories={TREE} all={TREE} onValue={(v) => seen.push(v)} />)
    fireEvent.click(sectionHeader('Electronics'))
    const headphones = within(section('Electronics')).getByRole('button', { name: /^Headphones/ })
    fireEvent.click(headphones)
    expect(headphones).toHaveAttribute('aria-pressed', 'true')
    expect(sectionHeader('Electronics')).toHaveTextContent('1 selected')
    fireEvent.click(within(section('Electronics')).getByRole('button', { name: /^Headphones/ }))
    expect(seen).toEqual([[102], []])
    expect(sectionHeader('Electronics')).toHaveAttribute('aria-expanded', 'true')
  })

  it('names the picks by their path under the chips, in pick order with the main first', () => {
    render(<Harness categories={TREE} all={TREE} initial={[301, 101, 200]} />)
    expect(screen.getByText(/^Selected:/)).toHaveTextContent(
      'Selected: Jewelry › Accessories (main) · Electronics › Accessories · Clothing',
    )
  })

  it('a search box narrows the list to matching categories and opens their sections', () => {
    render(<Harness categories={BIG} all={BIG} />)
    const search = screen.getByRole('searchbox', { name: 'Search categories' })
    expect(screen.getAllByRole('button', { expanded: false })).toHaveLength(3)

    fireEvent.change(search, { target: { value: 'ACCESS' } })
    for (const dept of ['Electronics', 'Clothing', 'Jewelry']) {
      expect(sectionHeader(dept)).toHaveAttribute('aria-expanded', 'true')
      expect(within(section(dept)).getAllByRole('button').map((b) => b.textContent)).toEqual(['Accessories'])
    }

    // The path matches too: a department name finds every category under it.
    fireEvent.change(search, { target: { value: 'jewel' } })
    expect(sectionHeader('Electronics')).toBeUndefined()
    expect(within(section('Jewelry')).getAllByRole('button').map((b) => b.textContent)).toEqual(['Jewelry — general', 'Accessories', 'Watches'])

    fireEvent.change(search, { target: { value: 'zzz' } })
    expect(screen.getByText('No categories match “zzz”.')).toBeInTheDocument()

    fireEvent.change(search, { target: { value: '' } })
    expect(screen.getAllByRole('button', { expanded: false })).toHaveLength(3)
  })

  it('a pick made while searching keeps its section open once the search is cleared', () => {
    const seen = []
    render(<Harness categories={BIG} all={BIG} onValue={(v) => seen.push(v)} />)
    const search = screen.getByRole('searchbox', { name: 'Search categories' })
    fireEvent.change(search, { target: { value: 'watch' } })
    fireEvent.click(within(section('Jewelry')).getByRole('button', { name: /^Watches/ }))
    expect(seen).toEqual([[302]])
    fireEvent.change(search, { target: { value: '' } })
    expect(sectionHeader('Jewelry')).toHaveAttribute('aria-expanded', 'true')
    expect(sectionHeader('Jewelry')).toHaveTextContent('1 selected')
    expect(screen.getByText(/^Selected:/)).toHaveTextContent('Selected: Jewelry › Watches (main)')
  })

  it('Enter in the search box does not submit the form the chips sit in', () => {
    let submitted = 0
    render(<form onSubmit={(e) => { e.preventDefault(); submitted += 1 }}><Harness categories={BIG} all={BIG} /></form>)
    const search = screen.getByRole('searchbox', { name: 'Search categories' })
    fireEvent.change(search, { target: { value: 'watch' } })
    const enter = fireEvent.keyDown(search, { key: 'Enter' })
    expect(enter).toBe(false) // default prevented: no implicit submission
    expect(submitted).toBe(0)
  })

  it('a flat list keeps flat chips: no sections, no search box, no summary', () => {
    render(<Harness initial={[1]} />)
    expect(screen.queryAllByRole('button', { expanded: false })).toHaveLength(0)
    expect(screen.queryAllByRole('button', { expanded: true })).toHaveLength(0)
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
    expect(screen.queryByText(/^Selected:/)).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { pressed: undefined })).toHaveLength(OPTIONS.length)
  })
})
