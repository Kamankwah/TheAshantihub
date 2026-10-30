import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import EventCategorySection from '../EventCategorySection.jsx'

const CATS = [
  { id: 7, slug: 'concerts', icon: '🎤', label: 'Concerts', kind: 'event' },
  { id: 8, slug: 'festivals', icon: '🎉', label: 'Festivals', kind: 'event' },
]

function setup(filters = {}, categories = CATS) {
  const setFilters = vi.fn()
  const view = render(<EventCategorySection categories={categories} filters={filters} setFilters={setFilters} />)
  return { view, applied: (n = 0, state = filters) => setFilters.mock.calls[n][0](state) }
}

describe('EventCategorySection', () => {
  it('renders nothing without categories', () => {
    for (const categories of [[], undefined]) {
      const { container } = render(<EventCategorySection categories={categories} filters={{}} setFilters={vi.fn()} />)
      expect(container).toBeEmptyDOMElement()
    }
  })

  it('lists All categories then each category with its icon hidden from assistive tech', () => {
    setup()
    expect(screen.getByRole('radiogroup', { name: 'Category' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'All categories' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Concerts' })).toBeInTheDocument()
    expect(screen.getByText('🎤')).toHaveAttribute('aria-hidden', 'true')
  })

  it('selecting sets the slug; All categories clears to undefined', () => {
    const { applied } = setup({ category: 'concerts', zone: 'Adum' })
    expect(screen.getByRole('radio', { name: 'Concerts' })).toBeChecked()
    fireEvent.click(screen.getByRole('radio', { name: 'Festivals' }))
    expect(applied(0)).toStrictEqual({ category: 'festivals', zone: 'Adum' })
    fireEvent.click(screen.getByRole('radio', { name: 'All categories' }))
    expect(applied(1)).toStrictEqual({ category: undefined, zone: 'Adum' })
  })
})
