import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AboutFaqSection } from './components/ui/about-faq-section.tsx'

describe('AboutFaqSection', () => {
  it('renders all questions with answers collapsed by default', () => {
    render(<AboutFaqSection />)
    expect(screen.getByText('How does a business get verified on AshantiHub?')).toBeInTheDocument()
    expect(screen.queryByText(/Ghana Card, a registered digital address/)).not.toBeInTheDocument()
  })

  it('toggles an answer open and closed on click', () => {
    render(<AboutFaqSection />)
    const question = screen.getByText('How does a business get verified on AshantiHub?')
    fireEvent.click(question)
    expect(screen.getByText(/Ghana Card, a registered digital address/)).toBeInTheDocument()

    fireEvent.click(question)
    expect(screen.queryByText(/Ghana Card, a registered digital address/)).not.toBeInTheDocument()
  })

  it('accurately states that businesses cannot be contacted directly', () => {
    render(<AboutFaqSection />)
    fireEvent.click(screen.getByText('Can I contact a business directly through AshantiHub?'))
    expect(screen.getByText(/doesn't allow direct messaging or WhatsApp contact/)).toBeInTheDocument()
  })
})
