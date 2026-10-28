import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { server } from './mocks/server.js'
import { ContactPage } from './components/ui/contact-page.tsx'

describe('ContactPage', () => {
  it('renders_form_and_no_details_block', async () => {
    server.use(
      http.get('http://localhost:8000/api/core/site-settings/', () => HttpResponse.json({
        contact_email: 'hello@ashantihub.com', contact_phone: '+233201112233', contact_address: 'Adum, Kumasi',
        support_hours: '8am to 6pm', facebook_url: 'https://facebook.com/ashantihub', whatsapp_number: '233244000000',
      })),
    )
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <ContactPage user={null} onCreateAccount={vi.fn()} />
      </QueryClientProvider>,
    )
    expect(screen.getByRole('button', { name: /send/i })).toBeInTheDocument()
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByText('Contact Details')).not.toBeInTheDocument()
    expect(container.textContent).not.toMatch(/hello@ashantihub\.com|\+233201112233|Adum, Kumasi/)
    expect(container.querySelector('a[href^="tel:"], a[href^="mailto:"]')).toBeNull()
  })
})
