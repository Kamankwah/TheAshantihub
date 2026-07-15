import { describe, expect, it } from 'vitest'
import { groupCategoriesByKind } from './App.jsx'

describe('groupCategoriesByKind', () => {
  it('splits categories into products/services by kind', () => {
    const categories = [
      { id: 1, slug: 'hotels', kind: 'service' },
      { id: 2, slug: 'food', kind: 'product' },
      { id: 3, slug: 'akwasidae', kind: 'event' },
    ]
    const { productCategories, serviceCategories } = groupCategoriesByKind(categories)
    expect(productCategories).toEqual([{ id: 2, slug: 'food', kind: 'product' }])
    expect(serviceCategories).toEqual([{ id: 1, slug: 'hotels', kind: 'service' }])
  })

  it('excludes event-kind categories from both rows', () => {
    const categories = [{ id: 3, slug: 'akwasidae', kind: 'event' }]
    const { productCategories, serviceCategories } = groupCategoriesByKind(categories)
    expect(productCategories).toEqual([])
    expect(serviceCategories).toEqual([])
  })

  it('defaults categories with no explicit kind into products', () => {
    const categories = [{ id: 4, slug: 'crafts' }]
    const { productCategories, serviceCategories } = groupCategoriesByKind(categories)
    expect(productCategories).toEqual([{ id: 4, slug: 'crafts' }])
    expect(serviceCategories).toEqual([])
  })

  it('handles a null/undefined categories list gracefully', () => {
    expect(groupCategoriesByKind(null)).toEqual({ productCategories: [], serviceCategories: [] })
    expect(groupCategoriesByKind(undefined)).toEqual({ productCategories: [], serviceCategories: [] })
  })
})
