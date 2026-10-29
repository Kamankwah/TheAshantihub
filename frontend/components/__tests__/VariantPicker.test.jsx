import { describe, expect, test, vi } from 'vitest'
import { useState } from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import VariantPicker from '../shop/VariantPicker.jsx'

const axes = [
  { name: 'Colour', values: ['Gold', 'Red'] },
  { name: 'Size', values: ['Large', 'Small'] },
]
const v = (id, colour, size, extra = {}) => ({
  id, label: `${colour} / ${size}`, attributes: { Colour: colour, Size: size },
  price_amount: '150.00', effective_price: '120.00', was_price: null, discount_percent: null,
  stock_quantity: 5, available: true, ...extra,
})
const variants = [
  v(41, 'Gold', 'Large'),
  v(42, 'Gold', 'Small', { stock_quantity: 2 }),
  v(43, 'Red', 'Large', { available: false, stock_quantity: 0 }),
  // Red / Small has no variant at all
]

// A tiny host that owns the selection, as the product page does.
function Host({ onPreview, initial = {}, items = variants, ax = axes, currency }) {
  const [selection, setSelection] = useState(initial)
  return <VariantPicker axes={ax} variants={items} onPreview={onPreview} selection={selection} onChange={setSelection} currency={currency} />
}
const chip = (name) => screen.getByRole('button', { name })

describe('VariantPicker', () => {
  test('test_unavailable_combinations_are_dashed_and_cannot_be_chosen', () => {
    render(<Host />)
    // Red / Large exists but is available:false; Red / Small has no variant at all.
    fireEvent.click(chip('Large'))
    let red = chip('Red')
    expect(red).toHaveAttribute('aria-disabled', 'true')
    expect(red.style.borderStyle).toBe('dashed')
    expect(chip('Gold')).toHaveAttribute('aria-disabled', 'false')
    fireEvent.click(red)
    expect(screen.queryByTestId('selection-row')).toBeNull()
    fireEvent.click(chip('Small'))
    red = chip('Red')
    expect(red).toHaveAttribute('aria-disabled', 'true')
    expect(red.style.borderStyle).toBe('dashed')
    fireEvent.click(red)
    expect(screen.queryByTestId('selection-row')).toBeNull()
  })

  test('test_sparse_matrix_never_strands_the_shopper', () => {
    // Gold only in Large, Red only in Small.
    const sparse = [v(51, 'Gold', 'Large'), v(52, 'Red', 'Small')]
    render(<Host items={sparse} />)
    fireEvent.click(chip('Gold'))
    fireEvent.click(chip('Large'))
    expect(screen.getAllByTestId('selection-row')).toHaveLength(1)
    expect(chip('Red')).toHaveAttribute('aria-disabled', 'false')
    expect(chip('Small')).toHaveAttribute('aria-disabled', 'false')
    fireEvent.click(chip('Red'))
    fireEvent.click(chip('Small'))
    const rows = screen.getAllByTestId('selection-row')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent('Gold / Large')
    expect(rows[1]).toHaveTextContent('Red / Small')
  })

  test('test_choosing_a_combination_adds_a_selection_row_with_quantity_1', () => {
    render(<Host />)
    fireEvent.click(chip('Gold'))
    expect(screen.queryByTestId('selection-row')).toBeNull()
    fireEvent.click(chip('Large'))
    const row = screen.getByTestId('selection-row')
    expect(within(row).getByText('Gold / Large')).toBeInTheDocument()
    expect(within(row).getByTestId('qty-value')).toHaveTextContent('1')
    expect(within(row).getByText('GHS 120.00')).toBeInTheDocument()
  })

  test('test_several_variants_each_keep_their_own_quantity', () => {
    render(<Host />)
    fireEvent.click(chip('Gold'))
    fireEvent.click(chip('Large'))
    fireEvent.click(screen.getByRole('button', { name: 'Increase quantity of Gold / Large' }))
    fireEvent.click(chip('Small'))
    const rows = screen.getAllByTestId('selection-row')
    expect(rows).toHaveLength(2)
    expect(within(rows[0]).getByTestId('qty-value')).toHaveTextContent('2')
    expect(within(rows[1]).getByTestId('qty-value')).toHaveTextContent('1')
  })

  test('test_stepper_stops_at_counted_stock_and_says_only_n_left', () => {
    render(<Host initial={{ 42: 1 }} />)
    const plus = screen.getByRole('button', { name: 'Increase quantity of Gold / Small' })
    fireEvent.click(plus)
    expect(screen.getByTestId('qty-value')).toHaveTextContent('2')
    expect(plus).toBeDisabled()
    expect(screen.getByText('Only 2 left')).toBeInTheDocument()
    fireEvent.click(plus)
    expect(screen.getByTestId('qty-value')).toHaveTextContent('2')
  })

  test('test_untracked_stock_has_no_upper_bound', () => {
    const items = [v(41, 'Gold', 'Large', { stock_quantity: null })]
    render(<Host initial={{ 41: 99 }} items={items} ax={[{ name: 'Colour', values: ['Gold'] }, { name: 'Size', values: ['Large'] }]} />)
    const plus = screen.getByRole('button', { name: 'Increase quantity of Gold / Large' })
    fireEvent.click(plus)
    expect(screen.getByTestId('qty-value')).toHaveTextContent('100')
    expect(plus).not.toBeDisabled()
    expect(screen.queryByText(/Only \d+ left/)).toBeNull()
  })

  test('test_removing_a_row_clears_it', () => {
    render(<Host initial={{ 41: 2 }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove Gold / Large' }))
    expect(screen.queryByTestId('selection-row')).toBeNull()
  })

  test('test_stepping_down_to_zero_removes_the_row', () => {
    render(<Host initial={{ 41: 1 }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Decrease quantity of Gold / Large' }))
    expect(screen.queryByTestId('selection-row')).toBeNull()
  })

  test('test_preview_shows_image_without_adding', () => {
    const onPreview = vi.fn()
    const items = [v(41, 'Gold', 'Large', { image: 'https://x/gold.jpg' }), variants[1]]
    render(<Host onPreview={onPreview} items={items} />)
    fireEvent.click(chip('Gold'))
    fireEvent.mouseEnter(chip('Large'))
    expect(onPreview).toHaveBeenLastCalledWith(expect.objectContaining({ variantId: 41, image: 'https://x/gold.jpg', price: '120.00' }))
    expect(screen.queryByTestId('selection-row')).toBeNull()
  })

  test('test_preview_never_invents_an_image', () => {
    const onPreview = vi.fn()
    render(<Host onPreview={onPreview} />)
    fireEvent.click(chip('Gold'))
    fireEvent.mouseEnter(chip('Small'))
    expect(onPreview).toHaveBeenLastCalledWith(expect.objectContaining({ variantId: 42, image: null, price: '120.00' }))
  })

  test('test_the_selection_rows_convert_with_the_page_currency', () => {
    render(<Host currency="USD" initial={{ 41: 1 }} />)
    const row = screen.getByTestId('selection-row')
    expect(row).toHaveTextContent('USD 8') // 120 x 0.067, whole units, like the page price
    expect(row).not.toHaveTextContent('GHS')
  })
})
