import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import DealsSection from '../DealsSection.jsx'

describe('DealsSection', () => {
  it('an On sale checkbox that sets true, and undefined (never false) when cleared', () => {
    const setFilters = vi.fn()
    const { rerender } = render(<DealsSection filters={{}} setFilters={setFilters} />)
    const box = screen.getByRole('checkbox', { name: 'On sale' })
    expect(box).not.toBeChecked()
    fireEvent.click(box)
    expect(setFilters.mock.calls[0][0]({ zone: 'Adum' })).toStrictEqual({ zone: 'Adum', onSale: true })
    rerender(<DealsSection filters={{ onSale: true }} setFilters={setFilters} />)
    expect(screen.getByRole('checkbox', { name: 'On sale' })).toBeChecked()
    fireEvent.click(screen.getByRole('checkbox', { name: 'On sale' }))
    expect(setFilters.mock.calls[1][0]({ onSale: true })).toStrictEqual({ onSale: undefined })
  })
})
