import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import Sidebar from './components/Sidebar.jsx'

const ZONES = [
  { id: 1, name: 'Manhyia' },
  { id: 2, name: 'Adum' },
]

function renderSidebar(props = {}) {
  return render(
    <Sidebar
      zones={ZONES}
      filters={{}}
      setFilters={vi.fn()}
      minPriceInput=""
      setMinPriceInput={vi.fn()}
      maxPriceInput=""
      setMaxPriceInput={vi.fn()}
      onClear={vi.fn()}
      open={false}
      onClose={vi.fn()}
      {...props}
    />,
  )
}

describe('Sidebar', () => {
  it('renders the zone options', () => {
    renderSidebar()
    expect(screen.getByText('Manhyia')).toBeInTheDocument()
    expect(screen.getByText('Adum')).toBeInTheDocument()
  })

  it('calls setFilters with the selected zone', () => {
    const setFilters = vi.fn()
    renderSidebar({ setFilters })
    fireEvent.change(screen.getByLabelText('Zone'), { target: { value: 'Adum' } })
    expect(setFilters).toHaveBeenCalled()
    const updater = setFilters.mock.calls[0][0]
    expect(updater({})).toEqual({ zone: 'Adum' })
  })

  it('toggles the verified-only checkbox into filters', () => {
    const setFilters = vi.fn()
    renderSidebar({ setFilters })
    fireEvent.click(screen.getByText('Verified businesses only'))
    expect(setFilters).toHaveBeenCalled()
    const updater = setFilters.mock.calls[0][0]
    expect(updater({})).toEqual({ verified: true })
  })

  it('calls onClear when Clear Filters is clicked', () => {
    const onClear = vi.fn()
    renderSidebar({ onClear })
    fireEvent.click(screen.getByText('Clear Filters'))
    expect(onClear).toHaveBeenCalled()
  })

  it('calls setMinPriceInput/setMaxPriceInput on price input change', () => {
    const setMinPriceInput = vi.fn()
    const setMaxPriceInput = vi.fn()
    renderSidebar({ setMinPriceInput, setMaxPriceInput })
    fireEvent.change(screen.getByLabelText('Minimum price'), { target: { value: '100' } })
    fireEvent.change(screen.getByLabelText('Maximum price'), { target: { value: '500' } })
    expect(setMinPriceInput).toHaveBeenCalledWith('100')
    expect(setMaxPriceInput).toHaveBeenCalledWith('500')
  })

  it('calls onClose when the mobile close button is clicked', () => {
    const onClose = vi.fn()
    renderSidebar({ open: true, onClose })
    fireEvent.click(screen.getByLabelText('Close filters'))
    expect(onClose).toHaveBeenCalled()
  })

  it('hides price range, sort and verified toggle when their show flags are false (Events tab reuse)', () => {
    renderSidebar({ showPriceRange: false, showSort: false, showVerifiedToggle: false })
    expect(screen.queryByLabelText('Minimum price')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Maximum price')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Sort By')).not.toBeInTheDocument()
    expect(screen.queryByText('Verified businesses only')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Zone')).toBeInTheDocument()
  })
})
