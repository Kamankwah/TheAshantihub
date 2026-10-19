import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Footer2 } from './components/ui/footer-2.tsx'

// Task 11 (marketplace opening): the footer keeps only Support, About us and
// Contact plus the legal links. Phone, email, address, social and the
// business-register/dashboard links are gone, so the old site-settings
// rendering tests were removed on purpose.
function renderFooter2(props = {}) {
  return render(
    <Footer2 setPage={vi.fn()} setLegalDoc={vi.fn()} onSupport={vi.fn()} {...props} />,
  )
}

describe('Footer2', () => {
  it('has_support_about_contact_links_only', () => {
    renderFooter2()
    const nav = screen.getByRole('navigation', { name: 'Footer' })
    const labels = within(nav).getAllByRole('button').map((b) => b.textContent)
    expect(labels).toEqual(['Support', 'About us', 'Contact', 'Terms & Conditions', 'Privacy Notice', 'Business Agreement'])
  })

  it('shows_no_phone_email_address', async () => {
    const { container } = renderFooter2()
    expect(container.querySelector('a[href^="tel:"], a[href^="mailto:"], a[href*="wa.me"]')).toBeNull()
    expect(screen.queryByText(/@/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Kumasi/)).not.toBeInTheDocument()
    expect(screen.queryByLabelText('WhatsApp')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Facebook')).not.toBeInTheDocument()
  })

  it('wires the links to setPage, onSupport and setLegalDoc', () => {
    const setPage = vi.fn()
    const onSupport = vi.fn()
    const setLegalDoc = vi.fn()
    renderFooter2({ setPage, onSupport, setLegalDoc })
    fireEvent.click(screen.getByText('About us'))
    expect(setPage).toHaveBeenCalledWith('about')
    fireEvent.click(screen.getByText('Contact'))
    expect(setPage).toHaveBeenCalledWith('contact')
    fireEvent.click(screen.getByText('Support'))
    expect(onSupport).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByText('Terms & Conditions'))
    expect(setLegalDoc).toHaveBeenCalledWith('terms')
    fireEvent.click(screen.getByText('Privacy Notice'))
    expect(setLegalDoc).toHaveBeenCalledWith('privacy')
    fireEvent.click(screen.getByText('Business Agreement'))
    expect(setLegalDoc).toHaveBeenCalledWith('business')
  })

  it('has a Back to top bar that scrolls to the top', () => {
    const scrollTo = vi.fn()
    window.scrollTo = scrollTo
    renderFooter2()
    fireEvent.click(screen.getByRole('button', { name: 'Back to top' }))
    expect(scrollTo).toHaveBeenCalled()
  })

  it('renders the copyright line', () => {
    renderFooter2()
    expect(screen.getByText(/AshantiHub Ltd\. All Rights Reserved/)).toBeInTheDocument()
  })
})
