import { describe, expect, it } from 'vitest'
import { TREE } from '../../../mocks/storefront.js'
import {
  KIND_OPTIONS,
  PRICE_BANDS,
  SECTION_META,
  WHEN_OPTIONS,
  availableSections,
  clearSectionPatch,
  departmentNodes,
  effectiveKind,
  findNodePath,
  isSectionActive,
  kindPatch,
  sectionLabel,
  sectionsFor,
} from '../browseRailSections.js'

// A tree with a nested service node, so "the kind of the selected node" is
// tested below the top level too.
const SERVICE_TREE = [
  ...TREE,
  { id: 50, slug: 'beauty-services', label: 'Beauty services', icon: '💇', kind: 'service', is_accommodation: false, color: '#006400',
    children: [{ id: 51, slug: 'beauty-services-braiding', label: 'Braiding', icon: '💇', kind: 'service', is_accommodation: false, color: '#006400', children: [] }] },
]

describe('sectionsFor', () => {
  it('goods (kind product or no kind) on the business page', () => {
    const goods = ['department', 'rating', 'price', 'soldBy', 'deals', 'area']
    expect(sectionsFor({ mode: 'business', kind: undefined })).toEqual(goods)
    expect(sectionsFor({ mode: 'business', kind: 'product' })).toEqual(goods)
  })

  it('services on the business page', () => {
    expect(sectionsFor({ mode: 'business', kind: 'service' })).toEqual(['department', 'rating', 'price', 'verified', 'area'])
  })

  it('events, whatever kind is passed', () => {
    expect(sectionsFor({ mode: 'events' })).toEqual(['eventCategory', 'when', 'area'])
    expect(sectionsFor({ mode: 'events', kind: 'service' })).toEqual(['eventCategory', 'when', 'area'])
  })

  it('every section id has a label and an icon', () => {
    const ids = new Set([
      ...sectionsFor({ mode: 'business' }), ...sectionsFor({ mode: 'business', kind: 'service' }), ...sectionsFor({ mode: 'events' }),
    ])
    for (const id of ids) {
      expect(SECTION_META[id].label, id).toBeTruthy()
      expect(SECTION_META[id].icon, id).toBeTruthy()
    }
  })
})

describe('sectionLabel', () => {
  it('department reads "Department" for goods and "Category" for services; the rest are fixed', () => {
    expect(sectionLabel('department', undefined)).toBe('Department')
    expect(sectionLabel('department', 'product')).toBe('Department')
    expect(sectionLabel('department', 'service')).toBe('Category')
    expect(sectionLabel('rating')).toBe('Customer reviews')
    expect(sectionLabel('soldBy')).toBe('Sold by')
    expect(sectionLabel('verified')).toBe('Seller')
    expect(sectionLabel('eventCategory')).toBe('Category')
    expect(sectionLabel('when')).toBe('When')
    expect(sectionLabel('area')).toBe('Area')
  })
})

describe('departmentNodes', () => {
  it('lists top-level non-event nodes when no kind is in effect', () => {
    expect(departmentNodes(TREE, undefined).map((n) => n.slug)).toEqual(['electronics', 'books', 'hotels'])
  })

  it('lists only the nodes of the kind in effect', () => {
    expect(departmentNodes(TREE, 'product').map((n) => n.slug)).toEqual(['electronics', 'books'])
    expect(departmentNodes(TREE, 'service').map((n) => n.slug)).toEqual(['hotels'])
  })

  it('is empty while the tree is loading or not an array', () => {
    expect(departmentNodes(undefined, undefined)).toEqual([])
    expect(departmentNodes({ detail: 'error' }, 'product')).toEqual([])
  })
})

describe('findNodePath and effectiveKind', () => {
  it('finds a node anywhere in the tree, with its ancestors', () => {
    expect(findNodePath(TREE, 'electronics-headphones').map((n) => n.slug)).toEqual(['electronics', 'electronics-headphones'])
    expect(findNodePath(TREE, 'books').map((n) => n.slug)).toEqual(['books'])
    expect(findNodePath(TREE, 'nope')).toBeNull()
    expect(findNodePath(TREE, undefined)).toBeNull()
    expect(findNodePath(undefined, 'books')).toBeNull()
  })

  it('filters.kind wins over the selected node', () => {
    expect(effectiveKind({ kind: 'service', category: 'books' }, TREE)).toBe('service')
  })

  it('falls back to the kind of the selected node, nested or top-level', () => {
    expect(effectiveKind({ category: 'electronics-headphones' }, TREE)).toBe('product')
    expect(effectiveKind({ category: 'beauty-services-braiding' }, SERVICE_TREE)).toBe('service')
    expect(effectiveKind({ category: 'hotels' }, TREE)).toBe('service')
  })

  it('is undefined with no kind and no known category', () => {
    expect(effectiveKind({}, TREE)).toBeUndefined()
    expect(effectiveKind({ category: 'gone' }, TREE)).toBeUndefined()
    expect(effectiveKind(undefined, TREE)).toBeUndefined()
  })
})

describe('availableSections', () => {
  const goods = sectionsFor({ mode: 'business' })
  const events = sectionsFor({ mode: 'events' })
  const zones = [{ id: 1, name: 'Adum' }]
  const eventCategories = [{ id: 9, slug: 'concerts', label: 'Concerts', kind: 'event' }]

  it('keeps every section when each has something to filter on', () => {
    expect(availableSections(goods, { departmentNodes: TREE.slice(0, 1), zones, eventCategories })).toEqual(goods)
    expect(availableSections(events, { departmentNodes: [], zones, eventCategories })).toEqual(events)
  })

  it('drops department with no department nodes and area with no zones', () => {
    expect(availableSections(goods, { departmentNodes: [], zones: [], eventCategories })).toEqual(['rating', 'price', 'soldBy', 'deals'])
    expect(availableSections(goods, {})).toEqual(['rating', 'price', 'soldBy', 'deals'])
  })

  it('drops the event category section with no event categories', () => {
    expect(availableSections(events, { zones, eventCategories: [] })).toEqual(['when', 'area'])
    expect(availableSections(events, { zones })).toEqual(['when', 'area'])
  })
})

describe('kind switcher', () => {
  const state = { kind: 'product', category: 'books', onSale: true, directOnly: true, verified: true, zone: 'Adum', minRating: 4 }

  it('offers All, Products and Services', () => {
    expect(KIND_OPTIONS).toEqual([
      { value: undefined, label: 'All' },
      { value: 'product', label: 'Products' },
      { value: 'service', label: 'Services' },
    ])
  })

  it('switching to services clears the category and the goods-only filters', () => {
    expect({ ...state, ...kindPatch('service') }).toStrictEqual({
      kind: 'service', category: undefined, onSale: undefined, directOnly: undefined, verified: true, zone: 'Adum', minRating: 4,
    })
  })

  it('switching to products or all clears only the category', () => {
    expect({ ...state, ...kindPatch('product') }).toStrictEqual({ ...state, kind: 'product', category: undefined })
    expect({ ...state, ...kindPatch(undefined) }).toStrictEqual({ ...state, kind: undefined, category: undefined })
  })
})

describe('section values', () => {
  it('a section is active only when one of its filters holds a value', () => {
    expect(isSectionActive('rating', { minRating: 4 })).toBe(true)
    expect(isSectionActive('rating', { minRating: undefined })).toBe(false)
    expect(isSectionActive('price', { maxPrice: 50 })).toBe(true)
    expect(isSectionActive('price', { minPrice: 0 })).toBe(true)
    expect(isSectionActive('soldBy', { verified: true })).toBe(true)
    expect(isSectionActive('soldBy', { directOnly: true })).toBe(true)
    expect(isSectionActive('verified', { directOnly: true })).toBe(false)
    expect(isSectionActive('department', { category: 'books' })).toBe(true)
    expect(isSectionActive('eventCategory', { category: 'concerts' })).toBe(true)
    expect(isSectionActive('area', { zone: '' })).toBe(false)
    expect(isSectionActive('deals', { onSale: false })).toBe(false)
    expect(isSectionActive('when', {})).toBe(false)
    expect(isSectionActive('when', undefined)).toBe(false)
  })

  it('clearing a section sets exactly its own filters to undefined', () => {
    expect(clearSectionPatch('price')).toStrictEqual({ minPrice: undefined, maxPrice: undefined })
    expect(clearSectionPatch('soldBy')).toStrictEqual({ directOnly: undefined, verified: undefined })
    expect(clearSectionPatch('verified')).toStrictEqual({ verified: undefined })
    expect(clearSectionPatch('department')).toStrictEqual({ category: undefined })
    expect(clearSectionPatch('rating')).toStrictEqual({ minRating: undefined })
    expect(clearSectionPatch('deals')).toStrictEqual({ onSale: undefined })
    expect(clearSectionPatch('area')).toStrictEqual({ zone: undefined })
    expect(clearSectionPatch('when')).toStrictEqual({ when: undefined })
    expect(clearSectionPatch('eventCategory')).toStrictEqual({ category: undefined })
  })
})

describe('price bands and time windows', () => {
  it('has the five GH₵ bands with their bounds', () => {
    expect(PRICE_BANDS.map(({ min, max }) => [min, max])).toEqual([
      [undefined, 50], [50, 100], [100, 200], [200, 500], [500, undefined],
    ])
    expect(PRICE_BANDS.map((b) => b.label)).toEqual([
      'Under GH₵ 50', 'GH₵ 50 to GH₵ 100', 'GH₵ 100 to GH₵ 200', 'GH₵ 200 to GH₵ 500', 'GH₵ 500 and above',
    ])
  })

  it('has today, this week and this month', () => {
    expect(WHEN_OPTIONS).toEqual([
      { value: 'today', label: 'Today' },
      { value: 'week', label: 'This week' },
      { value: 'month', label: 'This month' },
    ])
  })
})
