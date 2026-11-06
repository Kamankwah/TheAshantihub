import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { server } from './mocks/server.js'
import { setStoredAuth } from './apiClient.js'
import ConfirmEmailPage from './components/ConfirmEmailPage.jsx'

const CONFIRM = 'http://localhost:8000/api/accounts/email-confirmation/confirm/'
const RESEND = 'http://localhost:8000/api/accounts/business-owners/me/email-confirmation/'

function openWith(hash) {
  window.history.replaceState(null, '', `/confirm-email${hash}`)
}

beforeEach(() => setStoredAuth(null))
afterEach(() => { setStoredAuth(null); window.history.replaceState(null, '', '/') })

describe('ConfirmEmailPage', () => {
  it('posts the token from the fragment, removes it from the address bar and says the email is confirmed', async () => {
    const bodies = []
    server.use(http.post(CONFIRM, async ({ request }) => { bodies.push(await request.json()); return HttpResponse.json({ email_confirmed: true }) }))
    openWith('#token=abc123')
    render(<ConfirmEmailPage />)

    expect(await screen.findByText(/Your email is confirmed/)).toBeInTheDocument()
    expect(bodies).toEqual([{ token: 'abc123' }])
    expect(window.location.hash).toBe('')
    expect(window.location.pathname).toBe('/confirm-email')
  })

  it('posts the token exactly once under StrictMode', async () => {
    let posts = 0
    server.use(http.post(CONFIRM, () => { posts += 1; return HttpResponse.json({ email_confirmed: true }) }))
    openWith('#token=abc123')
    render(<StrictMode><ConfirmEmailPage /></StrictMode>)
    expect(await screen.findByText(/Your email is confirmed/)).toBeInTheDocument()
    expect(posts).toBe(1)
  })

  it('says the link was already used (410 used)', async () => {
    server.use(http.post(CONFIRM, () => HttpResponse.json({ detail: 'x', code: 'used' }, { status: 410 })))
    openWith('#token=abc123')
    render(<ConfirmEmailPage />)
    expect(await screen.findByRole('alert')).toHaveTextContent(/already been used/)
  })

  it('says the link has expired (410 expired)', async () => {
    server.use(http.post(CONFIRM, () => HttpResponse.json({ detail: 'x', code: 'expired' }, { status: 410 })))
    openWith('#token=abc123')
    render(<ConfirmEmailPage />)
    expect(await screen.findByRole('alert')).toHaveTextContent(/expired/)
  })

  it('says a newer link replaced it (410 revoked)', async () => {
    server.use(http.post(CONFIRM, () => HttpResponse.json({ detail: 'x', code: 'revoked' }, { status: 410 })))
    openWith('#token=abc123')
    render(<ConfirmEmailPage />)
    expect(await screen.findByRole('alert')).toHaveTextContent(/newer link/)
  })

  it('says the link is not valid (400)', async () => {
    server.use(http.post(CONFIRM, () => HttpResponse.json({ detail: 'x', code: 'invalid' }, { status: 400 })))
    openWith('#token=nope')
    render(<ConfirmEmailPage />)
    expect(await screen.findByRole('alert')).toHaveTextContent(/isn't valid/)
  })

  it('sends nothing when the link has no token', async () => {
    let called = false
    server.use(http.post(CONFIRM, () => { called = true; return HttpResponse.json({}) }))
    openWith('')
    render(<ConfirmEmailPage />)
    expect(await screen.findByRole('alert')).toHaveTextContent(/If you already confirmed your email, there is nothing more to do/)
    expect(called).toBe(false)
  })

  it('offers a new link only to a signed-in owner, and shows the server message when it is refused', async () => {
    server.use(http.post(CONFIRM, () => HttpResponse.json({ detail: 'x', code: 'expired' }, { status: 410 })))
    openWith('#token=abc123')
    const { unmount } = render(<ConfirmEmailPage />)
    await screen.findByRole('alert')
    expect(screen.queryByRole('button', { name: /send me a new link/i })).not.toBeInTheDocument()
    unmount()

    setStoredAuth({ token: 't', account_type: 'business_owner' })
    server.use(http.post(RESEND, () => HttpResponse.json({ detail: 'You have asked for too many links today. Try again tomorrow.' }, { status: 429 })))
    openWith('#token=abc123')
    render(<ConfirmEmailPage />)
    fireEvent.click(await screen.findByRole('button', { name: /send me a new link/i }))
    expect(await screen.findByText('You have asked for too many links today. Try again tomorrow.')).toBeInTheDocument()
  })

  it('confirms a new link was sent', async () => {
    setStoredAuth({ token: 't', account_type: 'business_owner' })
    server.use(
      http.post(CONFIRM, () => HttpResponse.json({ detail: 'x', code: 'expired' }, { status: 410 })),
      http.post(RESEND, () => new HttpResponse(null, { status: 204 })),
    )
    openWith('#token=abc123')
    render(<ConfirmEmailPage />)
    fireEvent.click(await screen.findByRole('button', { name: /send me a new link/i }))
    await waitFor(() => expect(screen.getByText(/new link is on its way/i)).toBeInTheDocument())
  })
})
