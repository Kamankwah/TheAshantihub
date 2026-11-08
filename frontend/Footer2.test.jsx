import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { server } from './mocks/server.js'
import { Footer2 } from './components/ui/footer-2.tsx'

// The footer links Support, About us, Contact and the legal documents, and shows AshantiHub's own saved Site Settings
// (email, phone, address, support hours, WhatsApp, social links) in a "Reach AshantiHub" block: only the fields that
// are filled in, nothing invented, and no column at all while the settings are empty.
const SETTINGS_URL = 'http://localhost:8000/api/core/site-settings/'
function renderFooter2(props = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <Footer2 setPage={vi.fn()} setLegalDoc={vi.fn()} onSupport={vi.fn()} {...props} />
    </QueryClientProvider>,
  )
}

describe('Footer2', () => {
  it('has_support_about_contact_links_only', () => {
    renderFooter2()
    const nav = screen.getByRole('navigation', { name: 'Footer' })
    const labels = within(nav).getAllByRole('button').map((b) => b.textContent)
    expect(labels).toEqual(['Support', 'About us', 'Contact', 'Terms & Conditions', 'Privacy Notice', 'Business Agreement'])
  })

  it('shows_no_reach_block_while_site_settings_are_empty', async () => {
    server.use(http.get(SETTINGS_URL, () => HttpResponse.json({ contact_email: '', contact_phone: '', contact_address: '', support_hours: '', whatsapp_number: '', facebook_url: '' })))
    const { container } = renderFooter2()
    await new Promise((r) => setTimeout(r, 100))
    expect(screen.queryByRole('region', { name: 'Reach AshantiHub' })).not.toBeInTheDocument()
    expect(container.querySelector('a[href^="tel:"], a[href^="mailto:"], a[href*="wa.me"]')).toBeNull()
  })

  it('shows_the_saved_site_settings_and_only_those', async () => {
    server.use(http.get(SETTINGS_URL, () => HttpResponse.json({
      contact_email: 'help@theashantihub.com', contact_phone: '+233 50 248 1685', contact_address: 'Adum, Kumasi',
      support_hours: 'Mon-Sat 8am-6pm', whatsapp_number: '233502481685', facebook_url: 'https://facebook.com/ashantihub',
      instagram_url: '', tiktok_url: 'javascript:alert(1)',
    })))
    renderFooter2()
    const reach = await screen.findByRole('region', { name: 'Reach AshantiHub' })
    expect(within(reach).getByRole('link', { name: 'help@theashantihub.com' })).toHaveAttribute('href', 'mailto:help@theashantihub.com')
    expect(within(reach).getByRole('link', { name: '+233 50 248 1685' })).toHaveAttribute('href', 'tel:+233502481685')
    expect(within(reach).getByText('Adum, Kumasi')).toBeInTheDocument()
    expect(within(reach).getByText(/Mon-Sat 8am-6pm/)).toBeInTheDocument()
    expect(within(reach).getByRole('link', { name: 'WhatsApp' })).toHaveAttribute('href', 'https://wa.me/233502481685')
    expect(within(reach).getByRole('link', { name: 'Facebook' })).toHaveAttribute('href', 'https://facebook.com/ashantihub')
    expect(within(reach).queryByRole('link', { name: 'Instagram' })).not.toBeInTheDocument()
    expect(within(reach).queryByRole('link', { name: 'TikTok' })).not.toBeInTheDocument()
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
