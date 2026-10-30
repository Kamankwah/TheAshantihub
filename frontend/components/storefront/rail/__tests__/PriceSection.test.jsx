import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import PriceSection from '../PriceSection.jsx'

function setup(extra = {}) {
  const props = {
    filters: {}, setFilters: vi.fn(), minPriceInput: '', setMinPriceInput: vi.fn(), maxPriceInput: '', setMaxPriceInput: vi.fn(), ...extra,
  }
  const view = render(<PriceSection {...props} />)
  const rerender = (more) => view.rerender(<PriceSection {...props} {...more} />)
  const applied = (n = 0, state = props.filters) => props.setFilters.mock.calls[n][0](state)
  return { props, rerender, applied }
}
const min = () => screen.getByLabelText('Min price (GH₵)')
const max = () => screen.getByLabelText('Max price (GH₵)')
const go = () => screen.getByRole('button', { name: 'Go' })

describe('PriceSection', () => {
  it('lists the five bands', () => {
    setup()
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Under GH₵ 50', 'GH₵ 50 to GH₵ 100', 'GH₵ 100 to GH₵ 200', 'GH₵ 200 to GH₵ 500', 'GH₵ 500 and above', 'Go',
    ])
  })

  it('a band sets both inputs and both filters', () => {
    const { props, applied } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'GH₵ 50 to GH₵ 100' }))
    expect(props.setMinPriceInput).toHaveBeenCalledWith('50')
    expect(props.setMaxPriceInput).toHaveBeenCalledWith('100')
    expect(applied()).toStrictEqual({ minPrice: 50, maxPrice: 100 })
  })

  it('an open-ended band leaves the other bound empty and undefined', () => {
    const { props, applied } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Under GH₵ 50' }))
    expect(props.setMinPriceInput).toHaveBeenLastCalledWith('')
    expect(props.setMaxPriceInput).toHaveBeenLastCalledWith('50')
    expect(applied(0)).toStrictEqual({ minPrice: undefined, maxPrice: 50 })
    fireEvent.click(screen.getByRole('button', { name: 'GH₵ 500 and above' }))
    expect(props.setMinPriceInput).toHaveBeenLastCalledWith('500')
    expect(props.setMaxPriceInput).toHaveBeenLastCalledWith('')
    expect(applied(1)).toStrictEqual({ minPrice: 500, maxPrice: undefined })
  })

  it('marks the band whose bounds match the filters', () => {
    setup({ filters: { minPrice: 100, maxPrice: 200 } })
    expect(screen.getByRole('button', { name: 'GH₵ 100 to GH₵ 200' })).toHaveAttribute('aria-current', 'true')
    expect(screen.getByRole('button', { name: 'Under GH₵ 50' })).not.toHaveAttribute('aria-current')
    expect(screen.getByRole('button', { name: 'GH₵ 500 and above' })).not.toHaveAttribute('aria-current')
  })

  it('Go applies a valid custom range as numbers', () => {
    const { props, applied } = setup()
    fireEvent.change(min(), { target: { value: '20' } })
    fireEvent.change(max(), { target: { value: '75.5' } })
    fireEvent.click(go())
    expect(applied()).toStrictEqual({ minPrice: 20, maxPrice: 75.5 })
    expect(props.setMinPriceInput).toHaveBeenCalledWith('20')
    expect(props.setMaxPriceInput).toHaveBeenCalledWith('75.5')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('Go with one bound empty leaves it undefined; both empty clears the range', () => {
    const { applied } = setup()
    fireEvent.change(min(), { target: { value: '30' } })
    fireEvent.click(go())
    expect(applied(0)).toStrictEqual({ minPrice: 30, maxPrice: undefined })
    fireEvent.change(min(), { target: { value: '' } })
    fireEvent.click(go())
    expect(applied(1, { minPrice: 30 })).toStrictEqual({ minPrice: undefined, maxPrice: undefined })
  })

  it.each([
    ['a negative minimum', '-5', '', 'Prices cannot be negative.'],
    ['a non-number', 'abc', '', 'Enter prices as numbers.'],
    ['a negative maximum', '', '-1', 'Prices cannot be negative.'],
    ['min above max', '90', '40', 'Minimum price cannot be above the maximum.'],
  ])('rejects %s with an alert and applies nothing', (_name, lo, hi, message) => {
    const { props } = setup()
    fireEvent.change(min(), { target: { value: lo } })
    fireEvent.change(max(), { target: { value: hi } })
    fireEvent.click(go())
    expect(screen.getByRole('alert')).toHaveTextContent(message)
    expect(props.setFilters).not.toHaveBeenCalled()
    expect(props.setMinPriceInput).not.toHaveBeenCalled()
  })

  it('the alert goes away after a valid Go, and Enter in a field submits', () => {
    const { applied } = setup()
    fireEvent.change(min(), { target: { value: '9' } })
    fireEvent.change(max(), { target: { value: '3' } })
    fireEvent.click(go())
    expect(screen.getByRole('alert')).toBeInTheDocument()
    fireEvent.change(max(), { target: { value: '30' } })
    fireEvent.submit(max().closest('form'))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(applied()).toStrictEqual({ minPrice: 9, maxPrice: 30 })
  })

  it('drafts re-sync when the props change (App Clear empties them)', () => {
    const { rerender } = setup({ minPriceInput: '50', maxPriceInput: '100' })
    expect(min()).toHaveValue('50')
    expect(max()).toHaveValue('100')
    fireEvent.change(min(), { target: { value: '7' } })
    rerender({ minPriceInput: '', maxPriceInput: '' })
    expect(min()).toHaveValue('')
    expect(max()).toHaveValue('')
  })
})
