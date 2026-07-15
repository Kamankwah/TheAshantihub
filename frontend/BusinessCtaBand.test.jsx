import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { BusinessCtaBand } from './components/ui/business-cta-band.tsx'

function renderBand(props = {}) {
  return render(<BusinessCtaBand onRegister={vi.fn()} {...props} />)
}

describe('BusinessCtaBand', () => {
  it('renders both panels', () => {
    renderBand()
    expect(screen.getByText('Own a Business in Ashanti?')).toBeInTheDocument()
    expect(screen.getByText('Download Our App')).toBeInTheDocument()
  })

  it('calls onRegister when the Register Your Business button is clicked', () => {
    const onRegister = vi.fn()
    renderBand({ onRegister })

    fireEvent.click(screen.getByText('Register Your Business →'))
    expect(onRegister).toHaveBeenCalledTimes(1)
  })

  it('shows a coming-soon message after entering a phone number and clicking Send Link', () => {
    renderBand()

    expect(screen.queryByText(/launching soon/i)).not.toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText(/024 123 4567/), { target: { value: '0241234567' } })
    fireEvent.click(screen.getByText('Send Link'))

    expect(screen.getByText(/launching soon/i)).toBeInTheDocument()
  })

  it('does not show the coming-soon message if Send Link is clicked with an empty phone number', () => {
    renderBand()

    fireEvent.click(screen.getByText('Send Link'))

    expect(screen.queryByText(/launching soon/i)).not.toBeInTheDocument()
  })

  it('renders the App Store and Play Store buttons', () => {
    renderBand()
    expect(screen.getByText('App Store')).toBeInTheDocument()
    expect(screen.getByText('Google Play')).toBeInTheDocument()
  })

  it('renders a QR code placeholder', () => {
    renderBand()
    expect(screen.getByLabelText('QR code')).toBeInTheDocument()
  })
})
