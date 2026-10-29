import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import BarcodeField from '../BarcodeField.jsx'

describe('BarcodeField', () => {
  it('test_shows_the_saved_key_in_its_shortest_standard_length', () => {
    render(<BarcodeField value="" onChange={() => {}} savedKey="00012345678905" />)
    expect(screen.getByText('Saved as 012345678905')).toBeInTheDocument()
  })

  it('test_server_error_is_shown_under_the_field', () => {
    const { rerender } = render(<BarcodeField value="12" onChange={() => {}} error={['That is not a valid barcode.']} />)
    expect(screen.getByText('That is not a valid barcode.')).toBeInTheDocument()
    rerender(<BarcodeField value="12" onChange={() => {}} error="Plain string error." />)
    expect(screen.getByText('Plain string error.')).toBeInTheDocument()
  })

  it('test_input_is_numeric_and_autocomplete_off', () => {
    render(<BarcodeField value="" onChange={() => {}} />)
    const input = screen.getByPlaceholderText('Barcode on the pack (optional)')
    expect(input).toHaveAttribute('inputmode', 'numeric')
    expect(input).toHaveAttribute('autocomplete', 'off')
    expect(screen.getByText("8, 12, 13 or 14 digits as printed. A shop's own price-sticker code is kept but never matched with other shops.")).toBeInTheDocument()
    expect(screen.queryByText(/Saved as/)).not.toBeInTheDocument()
  })
})
