import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import EtaLine from '../EtaLine.jsx'

const leg = { to: 'pickup', distance_km: 3.2, duration_s: 420, basis: 'road route' }

describe('EtaLine', () => {
  it('shows minutes, km and the basis', () => {
    render(<EtaLine leg={leg} />)
    expect(screen.getByText('About 7 min · 3.2 km · road route')).toBeInTheDocument()
  })

  it('rounds minutes up, with a minimum of 1', () => {
    render(<EtaLine leg={{ ...leg, duration_s: 61 }} />)
    expect(screen.getByText(/About 2 min/)).toBeInTheDocument()
  })

  it('never says 0 min', () => {
    render(<EtaLine leg={{ ...leg, duration_s: 10 }} />)
    expect(screen.getByText(/About 1 min/)).toBeInTheDocument()
  })

  it('shows the straight-line basis verbatim', () => {
    render(<EtaLine leg={{ ...leg, basis: 'straight-line estimate x 1.3' }} />)
    expect(screen.getByText(/straight-line estimate x 1\.3/)).toBeInTheDocument()
  })

  it('adds how old the last location is when stale', () => {
    render(<EtaLine leg={leg} stale ageS={240} />)
    expect(screen.getByText(/Last location 4 min ago/)).toBeInTheDocument()
  })

  it('has no stale note when fresh', () => {
    render(<EtaLine leg={leg} />)
    expect(screen.queryByText(/Last location/)).not.toBeInTheDocument()
  })

  it('renders nothing for a null leg', () => {
    const { container } = render(<EtaLine leg={null} stale />)
    expect(container).toBeEmptyDOMElement()
  })
})
