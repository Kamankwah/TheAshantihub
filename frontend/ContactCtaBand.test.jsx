import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { ContactCtaBand } from './components/ui/contact-cta-band.tsx'
import { server } from './mocks/server.js'

function MockWhatsAppButton({ phone, name }) {
  const msg = encodeURIComponent(`Hello! I found ${name} on AshantiHub and I'd like to enquire.`)
  return <a href={`https://wa.me/${phone}?text=${msg}`}>WhatsApp</a>
}

function renderBand(props = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <ContactCtaBand
        user={null}
        onCreateAccount={vi.fn()}
        whatsappPhone="233244000000"
        whatsappName="AshantiHub Support"
        WhatsAppButton={MockWhatsAppButton}
        {...props}
      />
    </QueryClientProvider>,
  )
}

describe('ContactCtaBand', () => {
  it('renders the support-focused heading (not a promotional pitch)', () => {
    renderBand()
    expect(screen.getByText('Prefer to talk to a human?')).toBeInTheDocument()
  })

  it('renders the WhatsApp link only for a signed-in user (guests use in-app chat)', () => {
    // WhatsApp is an account-holder support channel; a signed-out guest
    // sees no WhatsApp button (they use the in-app chat, open to everyone).
    const { rerender } = renderBand({ user: null })
    expect(screen.queryByText('WhatsApp')).not.toBeInTheDocument()

    rerender(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ContactCtaBand
          user={{ name: 'Ama' }}
          onCreateAccount={vi.fn()}
          whatsappPhone="233244000000"
          whatsappName="AshantiHub Support"
          WhatsAppButton={MockWhatsAppButton}
        />
      </QueryClientProvider>,
    )
    const link = screen.getByText('WhatsApp')
    expect(link).toHaveAttribute('href', expect.stringContaining('https://wa.me/233244000000'))
  })

  it('renders the contact_email from useSiteSettings as a mailto link when present', async () => {
    server.use(
      http.get('http://localhost:8000/api/core/site-settings/', () => HttpResponse.json({
        contact_email: 'hello@ashantihub.com', contact_phone: '', contact_address: '',
        facebook_url: '', instagram_url: '', linkedin_url: '', twitter_url: '',
      })),
    )
    renderBand()

    const link = await screen.findByText('hello@ashantihub.com')
    expect(link).toHaveAttribute('href', 'mailto:hello@ashantihub.com')
  })

  it('renders no email chip when contact_email is empty (the default handler)', async () => {
    renderBand({ user: { name: 'Ama' } })
    expect(await screen.findByText('WhatsApp')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /@/ })).not.toBeInTheDocument()
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
})
