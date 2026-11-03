import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import CategoryChips from '../CategoryChips.jsx'
import { C } from '../../theme.js'

const OPTIONS = [
  { id: 1, label: 'Electronics' },
  { id: 2, label: 'Fashion' },
  { id: 3, label: 'Groceries' },
  { id: 4, label: 'Furniture' },
]

function Harness({ initial = [], max, disabled, categories = OPTIONS, onValue }) {
  const [value, setValue] = useState(initial)
  return (
    <CategoryChips
      label="Categories"
      categories={categories}
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
