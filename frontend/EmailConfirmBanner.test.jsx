import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from './mocks/server.js'
import EmailConfirmBanner from './components/EmailConfirmBanner.jsx'

const RESEND = 'http://localhost:8000/api/accounts/business-owners/me/email-confirmation/'
const blocker = (code) => ({ code, message: `server says ${code}` })

describe('EmailConfirmBanner', () => {
  it('renders nothing when the business is live, has no go_live yet, or only other blockers remain', () => {
    const { container, rerender } = render(<EmailConfirmBanner goLive={{ live: true, blockers: [] }} />)
    expect(container).toBeEmptyDOMElement()
    rerender(<EmailConfirmBanner goLive={undefined} />)
    expect(container).toBeEmptyDOMElement()
    rerender(<EmailConfirmBanner goLive={{ live: false, blockers: [blocker('no_pin'), blocker('terms_missing')] }} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows for an unconfirmed email with a Resend button, also when blockers are bare codes', () => {
    render(<EmailConfirmBanner goLive={{ live: false, blockers: ['email_unconfirmed'] }} />)
    expect(screen.getByText('Confirm your email to publish listings')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Resend' })).toBeInTheDocument()
  })

  it('shows for a missing email with the server sentence and no Resend (there is nothing to send to)', () => {
    render(<EmailConfirmBanner goLive={{ live: false, blockers: [blocker('email_missing'), blocker('no_pin')] }} />)
    expect(screen.getByText('Confirm your email to publish listings')).toBeInTheDocument()
    expect(screen.getByText('server says email_missing')).toBeInTheDocument()
    expect(screen.getByText('Add your email in Profile & Settings (Request a change) so we can send you a confirmation link.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Resend' })).not.toBeInTheDocument()
  })

  it('stays hidden for a rejected application, even when the email is also a blocker', () => {
    const { container } = render(<EmailConfirmBanner goLive={{ live: false, blockers: [blocker('email_unconfirmed'), blocker('kyc_rejected')] }} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('resends and says where it went, using the address it was given', async () => {
    let posts = 0
    server.use(http.post(RESEND, () => { posts += 1; return new HttpResponse(null, { status: 204 }) }))
    render(<EmailConfirmBanner goLive={{ live: false, blockers: [blocker('email_unconfirmed')] }} email="abena@example.com" />)
    fireEvent.click(screen.getByRole('button', { name: 'Resend' }))
    expect(await screen.findByText('Sent to abena@example.com')).toBeInTheDocument()
    expect(posts).toBe(1)
  })

  it('does not name an address it was not given', async () => {
    server.use(http.post(RESEND, () => new HttpResponse(null, { status: 204 })))
    render(<EmailConfirmBanner goLive={{ live: false, blockers: [blocker('email_unconfirmed')] }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Resend' }))
    expect(await screen.findByText(/Sent\. Check your inbox/)).toBeInTheDocument()
    expect(screen.queryByText(/Sent to/)).not.toBeInTheDocument()
  })

  it('shows the server message when the daily limit is reached', async () => {
    server.use(http.post(RESEND, () => HttpResponse.json({ detail: 'Too many links today.', code: 'too_many_links' }, { status: 429 })))
    render(<EmailConfirmBanner goLive={{ live: false, blockers: [blocker('email_unconfirmed')] }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Resend' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many links today.')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Resend' })).not.toBeDisabled())
  })
})
