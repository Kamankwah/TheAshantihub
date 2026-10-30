import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import SoldBySection from '../SoldBySection.jsx'

function setup(props = {}) {
  const setFilters = vi.fn()
  render(<SoldBySection variant="soldBy" filters={{}} setFilters={setFilters} {...props} />)
  return { setFilters, applied: (n = 0, state = props.filters ?? {}) => setFilters.mock.calls[n][0](state) }
}

describe('SoldBySection', () => {
  it('goods: an Ashanti Direct checkbox named exactly "Sold by Ashanti Direct" and Verified sellers', () => {
    setup()
    expect(screen.getByRole('checkbox', { name: 'Sold by Ashanti Direct' })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Verified sellers' })).not.toBeChecked()
    expect(screen.getAllByRole('checkbox')).toHaveLength(2)
  })

  it('checking sets true; unchecking sets undefined, never false', () => {
    const { applied, setFilters } = setup({ filters: {} })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Sold by Ashanti Direct' }))
    expect(applied(0, { zone: 'Adum' })).toStrictEqual({ zone: 'Adum', directOnly: true })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Verified sellers' }))
    expect(setFilters.mock.calls[1][0]({})).toStrictEqual({ verified: true })
  })

  it('shows set filters as checked and unchecking clears to undefined', () => {
    const { setFilters } = setup({ filters: { directOnly: true, verified: true } })
    const direct = screen.getByRole('checkbox', { name: 'Sold by Ashanti Direct' })
    expect(direct).toBeChecked()
    fireEvent.click(direct)
    expect(setFilters.mock.calls[0][0]({ directOnly: true, verified: true })).toStrictEqual({ directOnly: undefined, verified: true })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Verified sellers' }))
    expect(setFilters.mock.calls[1][0]({ directOnly: true, verified: true })).toStrictEqual({ directOnly: true, verified: undefined })
  })

  it('services variant shows only Verified sellers', () => {
    setup({ variant: 'verified' })
    expect(screen.getAllByRole('checkbox')).toHaveLength(1)
    expect(screen.getByRole('checkbox', { name: 'Verified sellers' })).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'Sold by Ashanti Direct' })).not.toBeInTheDocument()
  })
})
