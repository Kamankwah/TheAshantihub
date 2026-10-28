import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getStoredAuth, setStoredAuth } from '../../apiClient.js'
import { clearViewAs, setViewAs } from '../../lib/viewAs.js'
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
afterEach(() => { setStoredAuth(null); clearViewAs(); window.history.replaceState(null, '', '/'); vi.restoreAllMocks() })

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

  it('sends no Authorization or view-as header on preview, confirm or decline, even with a stored sign-in', async () => {
    setStoredAuth({ token: 'stored-session-token', account_type: 'staff', id: 1 })
    const seen = []
    const note = (name) => ({ request }) => { seen.push([name, request.headers.get('authorization'), request.headers.get('x-view-as')]) }
    server.use(
      http.post(`${API}/preview/`, (c) => { note('preview')(c); return HttpResponse.json(preview()) }),
      http.post(`${API}/`, (c) => { note('confirm')(c); return HttpResponse.json({ confirmed: true }) }),
      http.post(`${API}/decline/`, (c) => { note('decline')(c); return HttpResponse.json({ declined: true }) }),
    )
    const first = renderAt('/business/confirm#token=t')
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm' }))
    await screen.findByRole('status')
    first.unmount()
    renderAt('/business/confirm#token=t')
    fireEvent.click(await screen.findByRole('button', { name: 'This is not right' }))
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await screen.findByRole('status')
    expect(seen.map(([name]) => name)).toEqual(['preview', 'confirm', 'preview', 'decline'])
    for (const [, authorization, viewAs] of seen) { expect(authorization).toBeNull(); expect(viewAs).toBeNull() }
    expect(getStoredAuth()?.token).toBe('stored-session-token') // the visitor's session is left alone
  })

  it('works while a staff view-as session is stored (not refused as view-only)', async () => {
    setStoredAuth({ token: 'super-admin-token', account_type: 'staff', id: 1 })
    setViewAs({ id: 7, full_name: 'Ama Boateng' }, 'super-admin-token')
    let viewAs = 'unset'
    let confirmed = false
    server.use(
      http.post(`${API}/preview/`, ({ request }) => { viewAs = request.headers.get('x-view-as'); return HttpResponse.json(preview()) }),
      http.post(`${API}/`, () => { confirmed = true; return HttpResponse.json({ confirmed: true }) }),
    )
    renderAt('/business/confirm#token=t')
    expect(await screen.findByText("Akosua's Kitchen")).toBeInTheDocument()
    expect(viewAs).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(await screen.findByRole('status')).toHaveTextContent(/confirmed/i)
    expect(confirmed).toBe(true)
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
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/already been used or replaced/i)
    expect(alert).toHaveTextContent(/newest message/i)
    expect(alert.textContent).not.toMatch(/whatsapp|@|\+233|\b0\d{9}\b/i)
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

  it('keeps the token out of the query cache key', async () => {
    server.use(http.post(`${API}/preview/`, () => HttpResponse.json(preview())))
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    window.history.replaceState(null, '', '/business/confirm#token=secret-key-check')
    render(<QueryClientProvider client={queryClient}><OwnerConfirmPage /></QueryClientProvider>)
    await screen.findByText("Akosua's Kitchen")
    const keys = queryClient.getQueryCache().getAll().map((query) => JSON.stringify(query.queryKey))
    expect(keys.length).toBeGreaterThan(0)
    expect(keys.join(' ')).not.toContain('secret-key-check')
  })
})
