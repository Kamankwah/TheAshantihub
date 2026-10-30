import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import RatingSection from '../RatingSection.jsx'

function setup(filters = {}) {
  const setFilters = vi.fn()
  render(<RatingSection filters={filters} setFilters={setFilters} />)
  return { setFilters, applied: (n = 0, state = filters) => setFilters.mock.calls[n][0](state) }
}

describe('RatingSection', () => {
  it('is a radio group with "4 stars and up" and "3 stars and up"', () => {
    setup()
    const group = screen.getByRole('radiogroup', { name: 'Customer reviews' })
    expect(group).toBeInTheDocument()
    expect(screen.getAllByRole('radio').map((r) => r.getAttribute('aria-label'))).toEqual(['4 stars and up', '3 stars and up'])
    expect(screen.getByRole('radio', { name: '4 stars and up' })).not.toBeChecked()
    expect(screen.getByRole('radio', { name: '3 stars and up' })).not.toBeChecked()
  })

  it('selecting sets minRating to the number and nothing else', () => {
    const { applied } = setup({ zone: 'Adum' })
    fireEvent.click(screen.getByRole('radio', { name: '4 stars and up' }))
    expect(applied()).toStrictEqual({ zone: 'Adum', minRating: 4 })
    fireEvent.click(screen.getByRole('radio', { name: '3 stars and up' }))
    expect(applied(1)).toStrictEqual({ zone: 'Adum', minRating: 3 })
  })

  it('shows the current value as checked', () => {
    setup({ minRating: 3 })
    expect(screen.getByRole('radio', { name: '3 stars and up' })).toBeChecked()
    expect(screen.getByRole('radio', { name: '4 stars and up' })).not.toBeChecked()
  })

  it('each radio label holds an aria-hidden glyph span with the visible text', () => {
    setup()
    const texts = ['4★ & up', '3★ & up']
    screen.getAllByRole('radio').forEach((radio, index) => {
      const glyph = radio.closest('label').querySelector('span')
      expect(glyph).toHaveAttribute('aria-hidden', 'true')
      expect(glyph).toHaveTextContent(texts[index])
    })
  })
})
