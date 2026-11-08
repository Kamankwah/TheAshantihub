import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, test } from 'vitest'
import { server } from '../../../mocks/server.js'
import PrivacyNoticePage from '../PrivacyNoticePage.jsx'
import { PRIVACY_GLANCE, PRIVACY_SECTIONS, PRIVACY_UPDATED } from '../privacyNotice.js'

const SETTINGS = 'http://localhost:8000/api/core/site-settings/'
const renderPage = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <PrivacyNoticePage />
  </QueryClientProvider>,
)

describe('PrivacyNoticePage', () => {
  test('shows the title, date, summary and every numbered section with a contents link', async () => {
    renderPage()
    expect(screen.getByRole('heading', { level: 1, name: 'Privacy Notice' })).toBeInTheDocument()
    expect(screen.getByText(`Last updated ${PRIVACY_UPDATED}`)).toBeInTheDocument()
    for (const line of PRIVACY_GLANCE) expect(screen.getByText(line)).toBeInTheDocument()
    const contents = screen.getByRole('navigation', { name: 'Contents' })
    PRIVACY_SECTIONS.forEach((section, i) => {
      expect(screen.getByRole('heading', { level: 2, name: `${i + 1}. ${section.title}` })).toBeInTheDocument()
      expect(within(contents).getByRole('link', { name: section.title })).toHaveAttribute('href', `#${section.id}`)
    })
    expect(screen.getByRole('heading', { level: 2, name: `${PRIVACY_SECTIONS.length + 1}. Contact` })).toBeInTheDocument()
  })

  test('the contact section shows only the details Site Settings holds, never an invented one', async () => {
    server.use(http.get(SETTINGS, () => HttpResponse.json({ contact_email: 'help@example.com', contact_phone: '', contact_address: '', support_hours: 'Mon-Sat 8am-8pm' })))
    renderPage()
    const list = await screen.findByTestId('privacy-contact')
    expect(within(list).getByRole('link', { name: 'help@example.com' })).toHaveAttribute('href', 'mailto:help@example.com')
    expect(within(list).getByText('Mon-Sat 8am-8pm')).toBeInTheDocument()
    expect(within(list).queryByText('Phone')).not.toBeInTheDocument()
    expect(within(list).queryByText('Address')).not.toBeInTheDocument()
  })

  test('with no contact details set it points to Contact Support instead of making one up', async () => {
    server.use(http.get(SETTINGS, () => HttpResponse.json({ contact_email: '', contact_phone: '', contact_address: '', support_hours: '' })))
    renderPage()
    expect(await screen.findByText(/Use Contact Support in the app/)).toBeInTheDocument()
    expect(screen.queryByTestId('privacy-contact')).not.toBeInTheDocument()
  })

  test('keeps the promises the product rules make: no direct business contact, no card or PIN, no sale of data', () => {
    renderPage()
    const all = document.body.textContent
    expect(all).toMatch(/Sellers cannot message you through AshantiHub/)
    expect(all).toMatch(/do not collect card numbers or mobile money PINs/)
    expect(all).toMatch(/do not sell personal data/)
    expect(all).toMatch(/Data Protection Act, 2012 \(Act 843\)/)
    expect(document.querySelector('a[href^="tel:"], a[href*="wa.me"]')).toBeNull()
  })
})
