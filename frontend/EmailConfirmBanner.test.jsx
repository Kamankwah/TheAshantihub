import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { server } from './mocks/server.js'
import { setStepUpHandler } from './apiClient.js'
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

  const missingGoLive = { live: false, blockers: [blocker('email_missing')] }
  const fill = (email, password = 'my-password') => {
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: email } })
    if (password !== null) fireEvent.change(screen.getByLabelText('Your password'), { target: { value: password } })
    fireEvent.click(screen.getByRole('button', { name: 'Send me a link' }))
  }

  it('labels both fields visibly and explains why the password is asked for', () => {
    render(<EmailConfirmBanner goLive={missingGoLive} />)
    expect(screen.getByLabelText('Email address').tagName).toBe('INPUT')
    expect(document.querySelector('label[for]')).not.toBeNull()
    const password = screen.getByLabelText('Your password')
    expect(password).toHaveAttribute('type', 'password')
    expect(password).toHaveAttribute('autocomplete', 'current-password')
    expect(screen.getByText('We ask for your password because this address can reset your account.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()
  })

  it('refuses a malformed address without calling the server, and ties the error to the field', async () => {
    let posts = 0
    server.use(http.post(SET_EMAIL, () => { posts += 1; return HttpResponse.json({ email: 'x', sent: true }) }))
    render(<EmailConfirmBanner goLive={missingGoLive} />)
    fill('not-an-email')
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Enter your email so we can send you a confirmation link.')
    const input = screen.getByLabelText('Email address')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input.getAttribute('aria-describedby')).toContain(alert.id)
    expect(posts).toBe(0)
  })

  it('refuses a blank password without calling the server', async () => {
    let posts = 0
    server.use(http.post(SET_EMAIL, () => { posts += 1; return HttpResponse.json({ email: 'x', sent: true }) }))
    render(<EmailConfirmBanner goLive={missingGoLive} />)
    fill('abena@example.com', '')
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Enter your current password to continue.')
    const input = screen.getByLabelText('Your password')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input.getAttribute('aria-describedby')).toContain(alert.id)
    expect(posts).toBe(0)
  })

  it('sends the trimmed address and the password, says where it went, asks for a refresh and keeps no password', async () => {
    let body
    server.use(http.post(SET_EMAIL, async ({ request }) => { body = await request.json(); return HttpResponse.json({ email: 'abena@example.com', sent: true }) }))
    const onSaved = vi.fn()
    render(<EmailConfirmBanner goLive={missingGoLive} onSaved={onSaved} />)
    fill('  abena@example.com  ', 'my-password')
    expect(await screen.findByText('Sent to abena@example.com')).toBeInTheDocument()
    expect(body).toEqual({ email: 'abena@example.com', password: 'my-password' })
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
    expect(document.body.innerHTML).not.toContain('my-password')
  })

  it('shows the wrong-password sentence under the password field and clears what was typed', async () => {
    server.use(http.post(SET_EMAIL, () => HttpResponse.json({ detail: "That password isn't right.", password: ["That password isn't right."], code: 'wrong_password' }, { status: 400 })))
    const onSaved = vi.fn()
    render(<EmailConfirmBanner goLive={missingGoLive} onSaved={onSaved} />)
    fill('abena@example.com', 'bad-guess')
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent("That password isn't right.")
    const password = screen.getByLabelText('Your password')
    expect(password).toHaveAttribute('aria-invalid', 'true')
    expect(password.getAttribute('aria-describedby')).toContain(alert.id)
    expect(password).toHaveValue('')
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('shows the server message when the address is rejected', async () => {
    server.use(http.post(SET_EMAIL, () => HttpResponse.json({ email: ['A business owner with this email already exists.'] }, { status: 400 })))
    const onSaved = vi.fn()
    render(<EmailConfirmBanner goLive={missingGoLive} onSaved={onSaved} />)
    fill('abena@example.com')
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('A business owner with this email already exists.')
    expect(screen.getByLabelText('Email address')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.queryByText(/Sent to/)).not.toBeInTheDocument()
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('shows the server sentence when the email is already confirmed (403)', async () => {
    server.use(http.post(SET_EMAIL, () => HttpResponse.json({ detail: 'Your email is confirmed. Change it in Profile & Settings, Request a change.', code: 'email_confirmed' }, { status: 403 })))
    render(<EmailConfirmBanner goLive={missingGoLive} />)
    fill('abena@example.com')
    expect(await screen.findByRole('alert')).toHaveTextContent('Request a change')
  })

  it('on the daily limit shows the server sentence and still refreshes (the new address was saved)', async () => {
    server.use(http.post(SET_EMAIL, () => HttpResponse.json({ detail: 'Too many links today. Try Resend tomorrow.', code: 'too_many_links' }, { status: 429 })))
    const onSaved = vi.fn()
    render(<EmailConfirmBanner goLive={missingGoLive} onSaved={onSaved} />)
    fill('abena@example.com')
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many links today. Try Resend tomorrow.')
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
  })

  it.each([
    [false, false], [true, false], [false, true], [true, true],
  ])('success lines for signed_out_phone=%s payout_cooling=%s appear only when true', async (signedOut, cooling) => {
    server.use(http.post(SET_EMAIL, () => HttpResponse.json({ email: 'abena@example.com', sent: true, side_effects: { signed_out_phone: signedOut, payout_cooling: cooling } })))
    render(<EmailConfirmBanner goLive={missingGoLive} />)
    fill('abena@example.com')
    expect(await screen.findByText('Sent to abena@example.com')).toBeInTheDocument()
    expect(screen.queryByText('You will be asked to sign in again on your phone.') !== null).toBe(signedOut)
    expect(screen.queryByText('For your safety, payout accounts wait a short cooling period again before withdrawals.') !== null).toBe(cooling)
  })

  it('shows no extra lines when the answer carries no side_effects', async () => {
    server.use(http.post(SET_EMAIL, () => HttpResponse.json({ email: 'abena@example.com', sent: true })))
    render(<EmailConfirmBanner goLive={missingGoLive} />)
    fill('abena@example.com')
    await screen.findByText('Sent to abena@example.com')
    expect(screen.queryByText(/sign in again/)).not.toBeInTheDocument()
    expect(screen.queryByText(/cooling period/)).not.toBeInTheDocument()
  })

  it('marks the email field invalid only for an email error, and the password field for a wrong password', async () => {
    const email = () => screen.getByLabelText('Email address')
    const password = () => screen.getByLabelText('Your password')
    // network failure: neither field is invalid
    server.use(http.post(SET_EMAIL, () => HttpResponse.error()))
    const { unmount } = render(<EmailConfirmBanner goLive={missingGoLive} />)
    fill('abena@example.com')
    await screen.findByRole('alert')
    expect(email()).not.toHaveAttribute('aria-invalid')
    expect(password()).not.toHaveAttribute('aria-invalid')
    unmount()
    // 429: not the email field's fault
    server.use(http.post(SET_EMAIL, () => HttpResponse.json({ detail: 'Too many links today.', code: 'too_many_links' }, { status: 429 })))
    const second = render(<EmailConfirmBanner goLive={missingGoLive} />)
    fill('abena@example.com')
    await screen.findByRole('alert')
    expect(email()).not.toHaveAttribute('aria-invalid')
    second.unmount()
    // wrong password marks the password field only
    server.use(http.post(SET_EMAIL, () => HttpResponse.json({ detail: "That password isn't right.", code: 'wrong_password' }, { status: 400 })))
    const third = render(<EmailConfirmBanner goLive={missingGoLive} />)
    fill('abena@example.com')
    await screen.findByRole('alert')
    expect(password()).toHaveAttribute('aria-invalid', 'true')
    expect(email()).not.toHaveAttribute('aria-invalid')
    third.unmount()
    // a cancelled step-up is not an email error either
    const off = setStepUpHandler(async () => null)
    server.use(http.post(SET_EMAIL, () => HttpResponse.json({ code: 'step_up_required', action: 'contact_change', detail: "Confirm it's you with a code first." }, { status: 403 })))
    render(<EmailConfirmBanner goLive={missingGoLive} />)
    fill('abena@example.com')
    await screen.findByRole('alert')
    expect(email()).not.toHaveAttribute('aria-invalid')
    off()
  })

  it('asks for a code through the shared step-up flow and retries with its token', async () => {
    const asked = []
    const off = setStepUpHandler(async (action) => { asked.push(action); return { token: 'tok-1', expiresIn: 60 } })
    let tokenSeen = null
    server.use(http.post(SET_EMAIL, async ({ request }) => {
      tokenSeen = request.headers.get('X-Step-Up-Token')
      if (!tokenSeen) return HttpResponse.json({ code: 'step_up_required', action: 'contact_change', detail: "Confirm it's you with a code first." }, { status: 403 })
      return HttpResponse.json({ email: 'abena@example.com', sent: true })
    }))
    render(<EmailConfirmBanner goLive={missingGoLive} />)
    fill('abena@example.com')
    expect(await screen.findByText('Sent to abena@example.com')).toBeInTheDocument()
    expect(asked).toEqual(['contact_change'])
    expect(tokenSeen).toBe('tok-1')
    off()
  })

  it('shows the code-first sentence from the server when the code step is cancelled', async () => {
    const off = setStepUpHandler(async () => null)
    server.use(http.post(SET_EMAIL, () => HttpResponse.json({ code: 'step_up_required', action: 'contact_change', detail: "Confirm it's you with a code first." }, { status: 403 })))
    render(<EmailConfirmBanner goLive={missingGoLive} />)
    fill('abena@example.com')
    expect(await screen.findByRole('alert')).toHaveTextContent("Confirm it's you with a code first.")
    off()
  })

  it('for an unconfirmed email keeps Resend and offers a quiet toggle that opens the form, and Cancel closes it', async () => {
    let body
    server.use(http.post(SET_EMAIL, async ({ request }) => { body = await request.json(); return HttpResponse.json({ email: 'new@example.com', sent: true }) }))
    render(<EmailConfirmBanner goLive={{ live: false, blockers: [blocker('email_unconfirmed')] }} />)
    expect(screen.getByRole('button', { name: 'Resend' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Email address')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Wrong address? Change it' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByLabelText('Email address')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Wrong address? Change it' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Wrong address? Change it' }))
    fill('new@example.com')
    expect(await screen.findByText('Sent to new@example.com')).toBeInTheDocument()
    expect(body).toEqual({ email: 'new@example.com', password: 'my-password' })
  })

  it('names the address the owner just typed when Resend is pressed afterwards', async () => {
    server.use(
      http.post(SET_EMAIL, () => HttpResponse.json({ email: 'new@example.com', sent: true })),
      http.post(RESEND, () => new HttpResponse(null, { status: 204 })),
    )
    render(<EmailConfirmBanner goLive={{ live: false, blockers: [blocker('email_unconfirmed')] }} email="old@example.com" />)
    fireEvent.click(screen.getByRole('button', { name: 'Wrong address? Change it' }))
    fill('new@example.com')
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
