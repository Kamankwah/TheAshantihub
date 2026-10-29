import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AboutPage } from './components/ui/about-page.tsx'

describe('AboutPage trust copy', () => {
  it('Hero no longer claims every listing is checked against a Ghana Card', () => {
    render(<AboutPage />)
    expect(screen.queryByText(/Every business is verified/)).not.toBeInTheDocument()
    expect(screen.queryByText(/no exceptions/i)).not.toBeInTheDocument()
    expect(screen.getByText(/Businesses can earn a verified check mark by showing their Ghana Card, and AshantiHub staff check every address\./)).toBeInTheDocument()
  })

  it('does not call every storefront or business verified (the mark needs an approved Ghana Card)', () => {
    render(<AboutPage />)
    expect(screen.queryByText(/verified digital storefront/)).not.toBeInTheDocument()
    expect(screen.queryByText(/verified Ashanti businesses/)).not.toBeInTheDocument()
    expect(screen.getByText(/a trusted digital storefront/)).toBeInTheDocument()
    expect(screen.getByText(/Ashanti businesses whose addresses we check/)).toBeInTheDocument()
  })
})
