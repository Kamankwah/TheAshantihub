import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { HomeCtaBand } from './components/ui/home-cta-band.tsx'

describe('HomeCtaBand', () => {
  it('renders the billboard heading and copy', () => {
    render(<HomeCtaBand />)
    expect(screen.getByText('Get the AshantiHub App')).toBeInTheDocument()
    expect(screen.getByText(/coming soon/i)).toBeInTheDocument()
  })

  it('does not claim the app can be downloaded yet (there is no mobile app)', () => {
    render(<HomeCtaBand />)
    expect(screen.queryByText(/download AshantiHub today/i)).not.toBeInTheDocument()
  })

  it('renders the App Store and Play Store buttons', () => {
    render(<HomeCtaBand />)
    expect(screen.getByText('App Store')).toBeInTheDocument()
    expect(screen.getByText('Google Play')).toBeInTheDocument()
  })

  it('does not render a QR code or phone-number capture form (that flow belongs to BusinessCtaBand)', () => {
    render(<HomeCtaBand />)
    expect(screen.queryByLabelText('QR code')).not.toBeInTheDocument()
    expect(screen.queryByPlaceholderText(/024 123 4567/)).not.toBeInTheDocument()
  })
})
