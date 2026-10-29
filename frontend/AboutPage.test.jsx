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
})
