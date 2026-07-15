import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { Footer2 } from './components/ui/footer-2.tsx'
import { server } from './mocks/server.js'

function renderFooter2(props = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <Footer2
        setPage={vi.fn()}
        setShowBizDash={vi.fn()}
        setLegalDoc={vi.fn()}
        {...props}
      />
    </QueryClientProvider>,
  )
}

describe('Footer2', () => {
  it('calls setLegalDoc with the right doc id for each legal link', () => {
    const setLegalDoc = vi.fn()
    renderFooter2({ setLegalDoc })

    fireEvent.click(screen.getByText('Terms & Conditions'))
    expect(setLegalDoc).toHaveBeenCalledWith('terms')

    fireEvent.click(screen.getByText('Privacy Notice'))
    expect(setLegalDoc).toHaveBeenCalledWith('privacy')

    fireEvent.click(screen.getByText('Business Agreement'))
    expect(setLegalDoc).toHaveBeenCalledWith('business')
  })

  it('calls setPage for the page-nav links', () => {
    const setPage = vi.fn()
    renderFooter2({ setPage })

    fireEvent.click(screen.getByText('About'))
    expect(setPage).toHaveBeenCalledWith('about')

    fireEvent.click(screen.getAllByText('Contact')[0])
    expect(setPage).toHaveBeenCalledWith('contact')

    fireEvent.click(screen.getByText('Register Your Business'))
    expect(setPage).toHaveBeenCalledWith('register')
  })

  it('calls setShowBizDash for the Business Dashboard link', () => {
    const setShowBizDash = vi.fn()
    renderFooter2({ setShowBizDash })

    fireEvent.click(screen.getByText('Business Dashboard'))
    expect(setShowBizDash).toHaveBeenCalledWith(true)
  })

  it('renders no social icons when useSiteSettings returns all-empty URLs (the default handler)', async () => {
    renderFooter2()
    expect(await screen.findByText('About')).toBeInTheDocument()
    expect(screen.queryByLabelText('Facebook')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Instagram')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('LinkedIn')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Twitter')).not.toBeInTheDocument()
  })

  it('renders only the social icons with a non-empty URL', async () => {
    server.use(
      http.get('http://localhost:8000/api/core/site-settings/', () => HttpResponse.json({
        contact_email: '', contact_phone: '', contact_address: '',
        facebook_url: 'https://facebook.com/ashantihub', instagram_url: '',
        linkedin_url: 'https://linkedin.com/company/ashantihub', twitter_url: '',
      })),
    )
    renderFooter2()

    expect(await screen.findByLabelText('Facebook')).toBeInTheDocument()
    expect(screen.getByLabelText('LinkedIn')).toBeInTheDocument()
    expect(screen.queryByLabelText('Instagram')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Twitter')).not.toBeInTheDocument()

    expect(screen.getByLabelText('Facebook')).toHaveAttribute('href', 'https://facebook.com/ashantihub')
    expect(screen.getByLabelText('LinkedIn')).toHaveAttribute('href', 'https://linkedin.com/company/ashantihub')
  })

  it('renders contact info when present', async () => {
    server.use(
      http.get('http://localhost:8000/api/core/site-settings/', () => HttpResponse.json({
        contact_email: 'hello@ashantihub.com', contact_phone: '', contact_address: 'Adum, Kumasi',
        facebook_url: '', instagram_url: '', linkedin_url: '', twitter_url: '',
      })),
    )
    renderFooter2()

    expect(await screen.findByText(/hello@ashantihub.com/)).toBeInTheDocument()
    expect(screen.getByText(/Adum, Kumasi/)).toBeInTheDocument()
  })

  it('renders no contact info line content when settings are empty (no hardcoded placeholder)', async () => {
    renderFooter2()
    expect(await screen.findByText('About')).toBeInTheDocument()
    expect(screen.queryByText(/@ashantihub/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Kumasi/)).not.toBeInTheDocument()
  })

  it('renders the copyright line', async () => {
    renderFooter2()
    expect(await screen.findByText(/AshantiHub Ltd\. All Rights Reserved/)).toBeInTheDocument()
  })
})
