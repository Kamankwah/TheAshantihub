import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import VerifiedMark from '../VerifiedMark.jsx'

describe('VerifiedMark', () => {
  it('renders for identity_verified true and nothing for false/undefined', () => {
    const { container, rerender } = render(<VerifiedMark verified={true} />)
    expect(screen.getByText('✓ Verified')).toBeInTheDocument()
    expect(screen.getByLabelText('Verified business')).toHaveAttribute('title', 'Identity checked by AshantiHub')

    for (const value of [false, undefined, null, 'true', 1]) {
      rerender(<VerifiedMark verified={value} />)
      expect(container).toBeEmptyDOMElement()
    }
  })

  it('has a compact variant that is still the same mark', () => {
    render(<VerifiedMark verified compact />)
    expect(screen.getByLabelText('Verified business')).toHaveTextContent('✓ Verified')
  })
})
