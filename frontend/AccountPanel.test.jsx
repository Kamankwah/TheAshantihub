import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import AccountPanel from './components/AccountPanel.jsx'

function renderPanel(props = {}) {
  return render(
    <AccountPanel
      user={{ fullName: 'Ama Boateng' }}
      favourites={['1', '2']}
      onClose={vi.fn()}
      onOpenSaved={vi.fn()}
      onOpenMessages={vi.fn()}
      {...props}
    />,
  )
}

describe('AccountPanel', () => {
  it('shows the user\'s name and saved-businesses count', () => {
    renderPanel()
    expect(screen.getByText('Ama Boateng')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('calls onOpenSaved when Saved Businesses is clicked', () => {
    const onOpenSaved = vi.fn()
    renderPanel({ onOpenSaved })
    fireEvent.click(screen.getByText('❤️ Saved Businesses'))
    expect(onOpenSaved).toHaveBeenCalledTimes(1)
  })

  it('calls onOpenMessages when Messages is clicked', () => {
    const onOpenMessages = vi.fn()
    renderPanel({ onOpenMessages })
    fireEvent.click(screen.getByText('💬 Messages'))
    expect(onOpenMessages).toHaveBeenCalledTimes(1)
  })

  it('calls onClose when the backdrop is clicked', () => {
    const onClose = vi.fn()
    const { container } = renderPanel({ onClose })
    fireEvent.click(container.firstChild)
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
