import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AboutFaqSection } from './components/ui/about-faq-section.tsx'

describe('AboutFaqSection', () => {
  it('renders all questions with answers collapsed by default', () => {
    render(<AboutFaqSection />)
    expect(screen.getByText('How does a business get verified on AshantiHub?')).toBeInTheDocument()
    expect(screen.queryByText(/earn a verified check mark by showing their Ghana Card/)).not.toBeInTheDocument()
  })

  it('toggles an answer open and closed on click', () => {
    render(<AboutFaqSection />)
    const question = screen.getByText('How does a business get verified on AshantiHub?')
    fireEvent.click(question)
    expect(screen.getByText(/earn a verified check mark by showing their Ghana Card/)).toBeInTheDocument()

    fireEvent.click(question)
    expect(screen.queryByText(/earn a verified check mark by showing their Ghana Card/)).not.toBeInTheDocument()
  })

  it('accurately states that businesses cannot be contacted directly', () => {
    render(<AboutFaqSection />)
    fireEvent.click(screen.getByText('Can I contact a business directly through AshantiHub?'))
    expect(screen.getByText(/doesn't allow direct messaging or WhatsApp contact/)).toBeInTheDocument()
  })

  it('does not claim every business is checked against a Ghana Card', () => {
    render(<AboutFaqSection />)
    fireEvent.click(screen.getByText('How does a business get verified on AshantiHub?'))
    expect(screen.queryByText(/Every business goes through/)).not.toBeInTheDocument()
    expect(screen.queryByText(/no exceptions/i)).not.toBeInTheDocument()
    expect(screen.getByText(/AshantiHub staff check every business address/)).toBeInTheDocument()
  })
})
