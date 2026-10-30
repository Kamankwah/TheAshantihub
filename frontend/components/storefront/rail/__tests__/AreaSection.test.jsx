import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import AreaSection from '../AreaSection.jsx'

const ZONES = Array.from({ length: 11 }, (_, i) => ({ id: i + 1, name: `Zone ${i + 1}` }))

function setup(filters = {}, zones = ZONES) {
  const setFilters = vi.fn()
  const view = render(<AreaSection zones={zones} filters={filters} setFilters={setFilters} />)
  return { setFilters, view, applied: (n = 0, state = filters) => setFilters.mock.calls[n][0](state) }
}
const radios = () => screen.getAllByRole('radio').map((r) => r.getAttribute('aria-label') ?? r.closest('label').textContent)

describe('AreaSection', () => {
  it('renders nothing without zones', () => {
    for (const zones of [[], undefined]) {
      const { container } = render(<AreaSection zones={zones} filters={{}} setFilters={vi.fn()} />)
      expect(container).toBeEmptyDOMElement()
    }
  })

  it('shows All areas and the first 8 zones, then See all areas', () => {
    setup()
    expect(screen.getByRole('radiogroup', { name: 'Area' })).toBeInTheDocument()
    expect(radios()).toEqual(['All areas', ...ZONES.slice(0, 8).map((z) => z.name)])
    expect(screen.getByRole('radio', { name: 'All areas' })).toBeChecked()
    const toggle = screen.getByRole('button', { name: 'See all areas' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(toggle)
    expect(screen.getAllByRole('radio')).toHaveLength(12)
    expect(screen.getByRole('button', { name: 'Show fewer areas' })).toHaveAttribute('aria-expanded', 'true')
  })

  it('has no toggle when there are 8 zones or fewer', () => {
    setup({}, ZONES.slice(0, 8))
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('selecting a zone sets its name; All areas clears to undefined', () => {
    const { applied } = setup({ zone: 'Zone 2', kind: 'product' })
    expect(screen.getByRole('radio', { name: 'Zone 2' })).toBeChecked()
    fireEvent.click(screen.getByRole('radio', { name: 'Zone 3' }))
    expect(applied(0)).toStrictEqual({ zone: 'Zone 3', kind: 'product' })
    fireEvent.click(screen.getByRole('radio', { name: 'All areas' }))
    expect(applied(1)).toStrictEqual({ zone: undefined, kind: 'product' })
  })

  it('opens expanded when the selected zone is beyond the first 8', () => {
    setup({ zone: 'Zone 10' })
    expect(screen.getByRole('radio', { name: 'Zone 10' })).toBeChecked()
  })
})
