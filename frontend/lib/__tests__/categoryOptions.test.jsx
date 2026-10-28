import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CategoryOptions, categoryOptionGroups, categoryPathLabel } from '../categoryOptions.jsx'

// Ruling R34: the flat category list repeats sub-category labels across
// departments; forms show departments as <optgroup>s instead.
const FLAT = [
  { id: 1, label: 'Electronics', icon: '📱', kind: 'product', parent: null },
  { id: 2, label: 'Accessories', icon: '', kind: 'product', parent: 1 },
  { id: 3, label: 'Headphones', icon: '', kind: 'product', parent: 1 },
  { id: 4, label: 'Clothing', icon: '👗', kind: 'product', parent: null },
  { id: 5, label: 'Accessories', icon: '', kind: 'product', parent: 4 },
  { id: 6, label: 'Books', icon: '📚', kind: 'product', parent: null },
  { id: 7, label: 'Hair & Beauty', icon: '💇', kind: 'service', parent: null },
  { id: 8, label: 'Hotels', icon: '🏨', kind: 'service', parent: null, is_accommodation: true },
]

describe('categoryOptionGroups', () => {
  it('groups sub-categories under their department and services under one group', () => {
    const groups = categoryOptionGroups(FLAT)
    expect(groups.map((g) => g.label)).toEqual(['📱 Electronics', '👗 Clothing', '📚 Books', 'Services'])
    expect(groups[0].options).toEqual([
      { id: 1, label: 'Electronics — general' }, { id: 2, label: 'Accessories' }, { id: 3, label: 'Headphones' },
    ])
    expect(groups[2].options).toEqual([{ id: 6, label: 'Books' }])
    expect(groups[3].options.map((o) => o.id)).toEqual([7, 8])
  })

  it('finds a department missing from a filtered list through `all`', () => {
    const groups = categoryOptionGroups([FLAT[4]], FLAT)
    expect(groups).toEqual([{ key: 'dept:4', label: '👗 Clothing', options: [{ id: 5, label: 'Accessories' }] }])
  })

  it('renders <optgroup>s with no repeated bare label inside a group', () => {
    const { container } = render(<select><CategoryOptions categories={FLAT} /></select>)
    const groups = [...container.querySelectorAll('optgroup')]
    expect(groups.map((g) => g.getAttribute('label'))).toContain('👗 Clothing')
    for (const g of groups) {
      const labels = [...g.querySelectorAll('option')].map((o) => o.textContent)
      expect(new Set(labels).size).toBe(labels.length)
    }
    expect(container.querySelectorAll('option')).toHaveLength(FLAT.length)
  })

  it('gives a flat "Department › Sub" label where only one label fits', () => {
    const labels = FLAT.map((c) => categoryPathLabel(c, FLAT))
    expect(labels).toContain('Electronics › Accessories')
    expect(labels).toContain('Clothing › Accessories')
    expect(new Set(labels).size).toBe(labels.length)
  })
})
