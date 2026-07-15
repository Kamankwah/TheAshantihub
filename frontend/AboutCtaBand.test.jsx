import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AboutCtaBand } from './components/ui/about-cta-band.tsx'

function renderBand(props = {}) {
  return render(<AboutCtaBand user={null} onCreateAccount={vi.fn()} onRegister={vi.fn()} {...props} />)
}

describe('AboutCtaBand', () => {
  it('renders the heading', () => {
    renderBand()
    expect(screen.getByText('Join the AshantiHub community')).toBeInTheDocument()
  })

  it('shows Create Free Account when signed out and calls onCreateAccount when clicked', () => {
    const onCreateAccount = vi.fn()
    renderBand({ user: null, onCreateAccount })

    fireEvent.click(screen.getByText('Create Free Account'))
    expect(onCreateAccount).toHaveBeenCalledTimes(1)
  })

  it('hides Create Free Account when signed in', () => {
    renderBand({ user: { name: 'Ama' } })
    expect(screen.queryByText('Create Free Account')).not.toBeInTheDocument()
  })

  it('calls onRegister when Register Business is clicked', () => {
    const onRegister = vi.fn()
    renderBand({ onRegister })

    fireEvent.click(screen.getByText('Register Business'))
    expect(onRegister).toHaveBeenCalledTimes(1)
  })
})
