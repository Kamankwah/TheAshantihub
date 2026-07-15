import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { ContactSocialRing } from './components/ui/contact-social-ring.tsx'
import { server } from './mocks/server.js'

function renderRing() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <ContactSocialRing />
    </QueryClientProvider>,
  )
}

describe('ContactSocialRing', () => {
  it('renders only the static brand badge when no socials are configured', async () => {
    server.use(
      http.get('http://localhost:8000/api/core/site-settings/', () => HttpResponse.json({
        contact_email: '', contact_phone: '', contact_address: '',
        facebook_url: '', instagram_url: '', linkedin_url: '', twitter_url: '',
        tiktok_url: '', youtube_url: '', whatsapp_number: '', support_hours: '',
      })),
    )
    renderRing()
    expect(await screen.findByText('AshantiHub')).toBeInTheDocument()
    expect(screen.queryByLabelText('Facebook')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('WhatsApp')).not.toBeInTheDocument()
  })

  it('renders a ring icon for each configured platform', async () => {
    server.use(
      http.get('http://localhost:8000/api/core/site-settings/', () => HttpResponse.json({
        contact_email: '', contact_phone: '', contact_address: '',
        facebook_url: 'https://facebook.com/ashantihub', instagram_url: '',
        linkedin_url: '', twitter_url: '',
        tiktok_url: '', youtube_url: '',
        whatsapp_number: '233244000000', support_hours: '',
      })),
    )
    renderRing()
    expect(await screen.findByLabelText('Facebook')).toHaveAttribute('href', 'https://facebook.com/ashantihub')
    expect(screen.getByLabelText('WhatsApp')).toHaveAttribute('href', 'https://wa.me/233244000000')
    expect(screen.getByText('AshantiHub')).toBeInTheDocument()
  })
})
