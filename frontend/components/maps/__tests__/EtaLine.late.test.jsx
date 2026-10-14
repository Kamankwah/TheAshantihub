import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import EtaLine from '../EtaLine.jsx'

describe('EtaLine for a late stop', () => {
  it('shows a time from now, never a clock time that has passed', () => {
    render(<EtaLine leg={{ duration_s: 600, distance_km: 2.1, basis: 'road route', to: 'pickup' }} prefix="To the shop: " />)
    expect(screen.getByText('To the shop: About 10 min · 2.1 km · road route')).toBeInTheDocument()
    expect(screen.queryByText(/\d{1,2}:\d{2}/)).not.toBeInTheDocument()
  })
})
