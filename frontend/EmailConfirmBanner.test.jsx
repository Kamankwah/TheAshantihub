import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { server } from './mocks/server.js'
import EmailConfirmBanner from './components/EmailConfirmBanner.jsx'

const RESEND = 'http://localhost:8000/api/accounts/business-owners/me/email-confirmation/'
const SET_EMAIL = 'http://localhost:8000/api/accounts/business-owners/me/email/'
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

  it('shows for a missing email with the server sentence, an email field and Send me a link (no Resend)', () => {
    render(<EmailConfirmBanner goLive={{ live: false, blockers: [blocker('email_missing'), blocker('no_pin')] }} />)
    expect(screen.getByText('Confirm your email to publish listings')).toBeInTheDocument()
    expect(screen.getByText('server says email_missing')).toBeInTheDocument()
    expect(screen.getByLabelText('Email address')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send me a link' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Resend' })).not.toBeInTheDocument()
    expect(screen.queryByText(/Request a change/)).not.toBeInTheDocument()
  })

  it('refuses a malformed address without calling the server', async () => {
    let posts = 0
    server.use(http.post(SET_EMAIL, () => { posts += 1; return HttpResponse.json({ email: 'x', sent: true }) }))
    render(<EmailConfirmBanner goLive={{ live: false, blockers: [blocker('email_missing')] }} />)
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'not-an-email' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send me a link' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter your email so we can send you a confirmation link.')
    expect(posts).toBe(0)
  })

  it('sends the trimmed address, says where it went and asks for a refresh', async () => {
    let body
    server.use(http.post(SET_EMAIL, async ({ request }) => { body = await request.json(); return HttpResponse.json({ email: 'abena@example.com', sent: true }) }))
    const onSaved = vi.fn()
    render(<EmailConfirmBanner goLive={{ live: false, blockers: [blocker('email_missing')] }} onSaved={onSaved} />)
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: '  abena@example.com  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send me a link' }))
    expect(await screen.findByText('Sent to abena@example.com')).toBeInTheDocument()
    expect(body).toEqual({ email: 'abena@example.com' })
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
  })

  it('shows the server message when the address is rejected', async () => {
    server.use(http.post(SET_EMAIL, () => HttpResponse.json({ email: ['A business owner with this email already exists.'] }, { status: 400 })))
    const onSaved = vi.fn()
    render(<EmailConfirmBanner goLive={{ live: false, blockers: [blocker('email_missing')] }} onSaved={onSaved} />)
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'abena@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send me a link' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('A business owner with this email already exists.')
    expect(screen.queryByText(/Sent to/)).not.toBeInTheDocument()
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('shows the server sentence when the email is already confirmed (403)', async () => {
    server.use(http.post(SET_EMAIL, () => HttpResponse.json({ detail: 'Your email is confirmed. Change it in Profile & Settings, Request a change.', code: 'email_confirmed' }, { status: 403 })))
    render(<EmailConfirmBanner goLive={{ live: false, blockers: [blocker('email_missing')] }} />)
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'abena@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send me a link' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Request a change')
  })

  it('on the daily limit shows the server sentence and still refreshes (the new address was saved)', async () => {
    server.use(http.post(SET_EMAIL, () => HttpResponse.json({ detail: 'Too many links today. Try Resend tomorrow.', code: 'too_many_links' }, { status: 429 })))
    const onSaved = vi.fn()
    render(<EmailConfirmBanner goLive={{ live: false, blockers: [blocker('email_missing')] }} onSaved={onSaved} />)
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'abena@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send me a link' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many links today. Try Resend tomorrow.')
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
  })

  it('for an unconfirmed email keeps Resend and offers a quiet Wrong address? Change it toggle', async () => {
    let body
    server.use(http.post(SET_EMAIL, async ({ request }) => { body = await request.json(); return HttpResponse.json({ email: 'new@example.com', sent: true }) }))
    render(<EmailConfirmBanner goLive={{ live: false, blockers: [blocker('email_unconfirmed')] }} />)
    expect(screen.getByRole('button', { name: 'Resend' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Email address')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Wrong address? Change it' }))
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'new@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send me a link' }))
    expect(await screen.findByText('Sent to new@example.com')).toBeInTheDocument()
    expect(body).toEqual({ email: 'new@example.com' })
  })

  it('names the address the owner just typed when Resend is pressed afterwards', async () => {
    server.use(
      http.post(SET_EMAIL, () => HttpResponse.json({ email: 'new@example.com', sent: true })),
      http.post(RESEND, () => new HttpResponse(null, { status: 204 })),
    )
    render(<EmailConfirmBanner goLive={{ live: false, blockers: [blocker('email_unconfirmed')] }} email="old@example.com" />)
    fireEvent.click(screen.getByRole('button', { name: 'Wrong address? Change it' }))
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'new@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send me a link' }))
    await screen.findByText('Sent to new@example.com')
    fireEvent.click(screen.getByRole('button', { name: 'Resend' }))
    await waitFor(() => expect(screen.getByText('Sent to new@example.com')).toBeInTheDocument())
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
