import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import LegalDocPage from '../LegalDocPage.jsx'
import { BUSINESS_TERMS_COPY } from '../../businessTerms.js'

describe('LegalDocPage', () => {
  it('Business Agreement shows every numbered clause of the text owners accept', () => {
    render(<LegalDocPage kind="business" onNavigate={vi.fn()} />)
    expect(screen.getByRole('heading', { level: 1, name: 'Business Agreement' })).toBeInTheDocument()
    const clauses = BUSINESS_TERMS_COPY.split('\n\n').slice(1)
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(clauses.length)
    expect(screen.getByRole('heading', { level: 2, name: '2. Customer Contact' })).toBeInTheDocument()
    expect(screen.getByText(/must not attempt to contact customers directly/)).toBeInTheDocument()
  })

  it('Terms says plainly that they are not published yet and points to what applies', () => {
    const onNavigate = vi.fn()
    const onSupport = vi.fn()
    render(<LegalDocPage kind="terms" onNavigate={onNavigate} onSupport={onSupport} />)
    expect(screen.getByRole('heading', { level: 1, name: 'Terms & Conditions' })).toBeInTheDocument()
    expect(screen.getByText(/not published yet/)).toBeInTheDocument()
    const related = screen.getByRole('navigation', { name: 'Related documents' })
    fireEvent.click(within(related).getByRole('link', { name: 'Privacy Notice' }))
    expect(onNavigate).toHaveBeenCalledWith('/privacy')
    fireEvent.click(within(related).getByRole('link', { name: /Business Agreement/ }))
    expect(onNavigate).toHaveBeenCalledWith('/business-agreement')
    fireEvent.click(within(related).getByRole('button', { name: 'Contact AshantiHub Support' }))
    expect(onSupport).toHaveBeenCalled()
  })
})
