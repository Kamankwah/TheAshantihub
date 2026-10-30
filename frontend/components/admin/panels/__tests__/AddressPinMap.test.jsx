import { render, screen } from '@testing-library/react'
import { useEffect } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The real AddressPinMap, with Leaflet itself replaced: this file checks only what AddressPinMap does with react-leaflet,
// which reads a MapContainer's centre once, when it mounts (test/setup.js stubs the whole component for every other test).
const mounts = vi.hoisted(() => ({ list: [] }))
vi.mock('react-leaflet', () => ({
  MapContainer: ({ center, children }) => {
    useEffect(() => { mounts.list.push(center) }, [])
    return <div data-testid="leaflet-map" data-center={center.join(',')}>{children}</div>
  },
  Marker: () => null,
  Circle: () => null,
}))
vi.mock('leaflet', () => ({ default: { divIcon: () => ({}) } }))
vi.mock('leaflet/dist/leaflet.css', () => ({}))
vi.mock('../../../maps/BaseTileLayers.jsx', () => ({ default: () => null }))
vi.unmock('../AddressPinMap.jsx')

const { default: AddressPinMap } = await vi.importActual('../AddressPinMap.jsx')

describe('AddressPinMap (real component)', () => {
  beforeEach(() => { mounts.list = [] })

  it('mounts a fresh map, centred on it, when the pin moves', () => {
    const { rerender } = render(<AddressPinMap pin={{ lat: 6.6885, lng: -1.6244, accuracy_m: 20 }} label="Shop" />)
    expect(screen.getByTestId('leaflet-map')).toHaveAttribute('data-center', '6.6885,-1.6244')
    rerender(<AddressPinMap pin={{ lat: 6.7, lng: -1.61, accuracy_m: 20 }} label="Shop" />)
    expect(mounts.list).toEqual([[6.6885, -1.6244], [6.7, -1.61]])
    expect(screen.getByTestId('leaflet-map')).toHaveAttribute('data-center', '6.7,-1.61')
  })

  it('keeps the same map when only the accuracy changes', () => {
    const { rerender } = render(<AddressPinMap pin={{ lat: 6.6885, lng: -1.6244, accuracy_m: 20 }} label="Shop" />)
    rerender(<AddressPinMap pin={{ lat: 6.6885, lng: -1.6244, accuracy_m: 9 }} label="Shop" />)
    expect(mounts.list).toHaveLength(1)
  })

  it('draws nothing for a pin without coordinates', () => {
    render(<AddressPinMap pin={{ lat: null, lng: null }} label="Shop" />)
    expect(screen.queryByTestId('leaflet-map')).not.toBeInTheDocument()
  })
})
