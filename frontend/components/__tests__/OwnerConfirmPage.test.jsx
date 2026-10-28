import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getStoredAuth, setStoredAuth } from '../../apiClient.js'
import { server } from '../../mocks/server.js'
import OwnerConfirmPage from '../OwnerConfirmPage.jsx'

const API = 'http://localhost:8000/api/portfolio/confirm'
const EXPIRED = 'This link has expired. Ask your AshantiHub contact to send a new one.'
const preview = (over = {}) => ({
  business_name: "Akosua's Kitchen", owner_name_first: 'Akosua', registration: false,
  items: [{ kind: 'product', name: 'Banku and tilapia', price: '35.00' }, { kind: 'service', name: 'Event catering', price: null }],
  expires_at: new Date(Date.now() + 5 * 86400000).toISOString(), ...over,
})
const refuse = (status, code, detail = 'x') => () => HttpResponse.json({ detail, code }, { status })

function renderAt(url) {
  window.history.replaceState(null, '', url)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}><OwnerConfirmPage /></QueryClientProvider>)
}
afterEach(() => { setStoredAuth(null); window.history.replaceState(null, '', '/'); vi.restoreAllMocks() })

describe('OwnerConfirmPage', () => {
  it('lists what the owner is asked to confirm and posts the token from the fragment on Confirm', async () => {
    const seen = { preview: null, confirm: null, auth: [] }
    server.use(
      http.post(`${API}/preview/`, async ({ request }) => { seen.preview = await request.json(); seen.auth.push(request.headers.get('authorization')); return HttpResponse.json(preview()) }),
      http.post(`${API}/`, async ({ request }) => { seen.confirm = await request.json(); return HttpResponse.json({ confirmed: true }) }),
    )
    renderAt('/business/confirm#token=raw-tok_1')
    expect(await screen.findByText("Akosua's Kitchen")).toBeInTheDocument()
    expect(screen.getByText('Banku and tilapia')).toBeInTheDocument()
    expect(screen.getByText('Event catering')).toBeInTheDocument()
    expect(screen.getByText('GH₵ 35.00')).toBeInTheDocument()
    expect(seen.preview).toEqual({ token: 'raw-tok_1' })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(await screen.findByRole('status')).toHaveTextContent(/confirmed/i)
    expect(seen.confirm).toEqual({ token: 'raw-tok_1' })
  })

  it('reads the token from the fragment and strips it from the address bar at once, keeping it out of storage', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    server.use(http.post(`${API}/preview/`, () => HttpResponse.json(preview())))
    renderAt('/business/confirm#token=secret-abc')
    await screen.findByText("Akosua's Kitchen")
    expect(window.location.hash).toBe('')
    expect(window.location.search).toBe('')
    expect(window.location.pathname).toBe('/business/confirm')
    expect(setItem.mock.calls.flat().join(' ')).not.toContain('secret-abc')
    expect(JSON.stringify({ ...localStorage })).not.toContain('secret-abc')
    expect(JSON.stringify({ ...sessionStorage })).not.toContain('secret-abc')
  })

  it('still accepts the older ?token= links and strips them too', async () => {
    let body = null
    server.use(http.post(`${API}/preview/`, async ({ request }) => { body = await request.json(); return HttpResponse.json(preview()) }))
    renderAt('/business/confirm?token=old-link')
    await screen.findByText("Akosua's Kitchen")
    expect(body).toEqual({ token: 'old-link' })
    expect(window.location.search).toBe('')
  })

  it('works for a visitor with a stale stored sign-in and sends no Authorization the server would reject', async () => {
    setStoredAuth({ token: 'stale', user: { id: 1 } })
    let calls = 0
    server.use(http.post(`${API}/preview/`, ({ request }) => {
      calls += 1
      if (request.headers.get('authorization')) return HttpResponse.json({ detail: 'Invalid token.' }, { status: 401 })
      return HttpResponse.json(preview())
    }))
    renderAt('/business/confirm#token=t')
    expect(await screen.findByText("Akosua's Kitchen")).toBeInTheDocument()
    expect(calls).toBeGreaterThan(0)
    expect(getStoredAuth()).toBeNull()
  })

  it('says an expired link has expired, with the exact line, and shows no buttons', async () => {
    server.use(http.post(`${API}/preview/`, refuse(410, 'expired', 'This link has expired.')))
    renderAt('/business/confirm#token=t')
    expect(await screen.findByRole('alert')).toHaveTextContent(EXPIRED)
    expect(screen.queryByRole('button', { name: 'Confirm' })).not.toBeInTheDocument()
  })

  it('says a used link was already used', async () => {
    server.use(http.post(`${API}/preview/`, refuse(409, 'used')))
    renderAt('/business/confirm#token=t')
    expect(await screen.findByRole('alert')).toHaveTextContent(/already been used/i)
  })

  it('says an invalid link is not valid, and a missing token is missing', async () => {
    server.use(http.post(`${API}/preview/`, refuse(400, 'invalid')))
    const { unmount } = renderAt('/business/confirm#token=bad')
    expect(await screen.findByRole('alert')).toHaveTextContent(/isn't valid/i)
    unmount()
    renderAt('/business/confirm')
    expect(await screen.findByRole('alert')).toHaveTextContent(/missing/i)
  })

  it('shows the expired message when confirming fails because the link expired meanwhile', async () => {
    server.use(
      http.post(`${API}/preview/`, () => HttpResponse.json(preview())),
      http.post(`${API}/`, refuse(410, 'expired')),
    )
    renderAt('/business/confirm#token=t')
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(EXPIRED)
  })

  it('asks for an optional reason on "This is not right" and posts it with the token', async () => {
    let body = null
    server.use(
      http.post(`${API}/preview/`, () => HttpResponse.json(preview())),
      http.post(`${API}/decline/`, async ({ request }) => { body = await request.json(); return HttpResponse.json({ declined: true }) }),
    )
    renderAt('/business/confirm#token=t')
    fireEvent.click(await screen.findByRole('button', { name: 'This is not right' }))
    const reason = screen.getByLabelText(/What is not right\? \(optional\)/)
    fireEvent.change(reason, { target: { value: 'The price is wrong' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(await screen.findByRole('status')).toHaveTextContent(/nothing will go live/i)
    expect(body).toEqual({ token: 't', reason: 'The price is wrong' })
  })

  it('declines without a reason too', async () => {
    let body = null
    server.use(
      http.post(`${API}/preview/`, () => HttpResponse.json(preview())),
      http.post(`${API}/decline/`, async ({ request }) => { body = await request.json(); return HttpResponse.json({ declined: true }) }),
    )
    renderAt('/business/confirm#token=t')
    fireEvent.click(await screen.findByRole('button', { name: 'This is not right' }))
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(body).toEqual({ token: 't', reason: '' }))
  })

  it('has no sign-in, password, phone, email or WhatsApp control', async () => {
    server.use(http.post(`${API}/preview/`, () => HttpResponse.json(preview({ registration: true }))))
    const { container } = renderAt('/business/confirm#token=t')
    await screen.findByText("Akosua's Kitchen")
    expect(container.querySelector('input[type="password"], input[type="tel"], input[type="email"]')).toBeNull()
    expect(screen.queryByText(/whatsapp|sign in|password/i)).not.toBeInTheDocument()
    expect(container.querySelector('a[href*="wa.me"], a[href^="tel:"]')).toBeNull()
  })

  it('offers Try again when the server cannot be reached, without calling the link bad', async () => {
    server.use(http.post(`${API}/preview/`, () => HttpResponse.json({ detail: 'oops' }, { status: 500 })))
    renderAt('/business/confirm#token=t')
    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn't load/i)
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })
})
