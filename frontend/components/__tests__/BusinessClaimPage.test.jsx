import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getStoredAuth, setStoredAuth } from '../../apiClient.js'
import { server } from '../../mocks/server.js'
import BusinessClaimPage from '../BusinessClaimPage.jsx'

const CLAIM_URL = 'http://localhost:8000/api/accounts/business-owners/claim/'
const PASSWORD = 'akwaaba-2026'
const preview = (overrides = {}) => ({
  business_name: 'Asafo Hair & Beauty', owner_name: 'Gifty Asantewaa', login_phone: '••••••••••761',
  area: 'Asafo', gps_address: 'AK-112-0384', registered_by_name: 'Kwame Asante', registered_at: '2026-10-08T10:52:00Z',
  terms_version: 'September 2026', channel: 'link', expires_at: new Date(Date.now() + 6 * 86400000).toISOString(),
  email_on_file: 'gi•••@example.com', ...overrides,
})
const LOAD_PROBLEM = "We couldn't load this link right now. Check your connection and try again."
afterEach(() => setStoredAuth(null))

function renderAt(path) {
  const onSignIn = vi.fn()
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}><BusinessClaimPage onSignIn={onSignIn} /></MemoryRouter>
    </QueryClientProvider>,
  )
  return onSignIn
}

function fillAndSave() {
  fireEvent.click(screen.getByLabelText(/I have read and accept/))
  fireEvent.change(screen.getByLabelText('Set your password'), { target: { value: PASSWORD } })
  fireEvent.change(screen.getByLabelText('Type it again'), { target: { value: PASSWORD } })
  fireEvent.click(screen.getByRole('button', { name: 'Save my login' }))
}

describe('BusinessClaimPage', () => {
  it("shows what was registered, claims with the link's token and offers Sign in", async () => {
    let previewToken = null
    let claimBody = null
    server.use(
      http.get(CLAIM_URL, ({ request }) => {
        previewToken = new URL(request.url).searchParams.get('token')
        return HttpResponse.json(preview())
      }),
      http.post(CLAIM_URL, async ({ request }) => {
        claimBody = await request.json()
        return HttpResponse.json({ claimed: true, login_phone: '+233201234761', business_name: 'Asafo Hair & Beauty' })
      }),
    )
    const onSignIn = renderAt('/business/claim?token=link-tok')
    expect(await screen.findByText('Asafo Hair & Beauty')).toBeInTheDocument()
    expect(previewToken).toBe('link-tok')
    fillAndSave()
    expect(await screen.findByText(/You're all set — sign in with \+233201234761 and your new password/)).toBeInTheDocument()
    expect(claimBody).toEqual({ token: 'link-tok', password: PASSWORD, password_confirm: PASSWORD, email: '', accept_terms: true })
    expect([...document.querySelectorAll('input')].some((input) => input.value === PASSWORD)).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(onSignIn).toHaveBeenCalledTimes(1)
  })

  it("shows an expired link's message and no form", async () => {
    server.use(http.get(CLAIM_URL, () => HttpResponse.json(
      { detail: 'This link has expired. Ask your account manager to send a new one.', code: 'expired' }, { status: 400 },
    )))
    renderAt('/business/claim?token=old-tok')
    expect(await screen.findByText('This link has expired. Ask your account manager to send a new one.')).toBeInTheDocument()
    expect(screen.queryByLabelText('Set your password')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Sign in' })).not.toBeInTheDocument()
  })

  it('points an already-used link at Sign in', async () => {
    server.use(http.get(CLAIM_URL, () => HttpResponse.json({
      detail: 'This link has already been used or replaced. Sign in with your phone number and password, or ask your account manager for a new link.',
      code: 'used',
    }, { status: 400 })))
    const onSignIn = renderAt('/business/claim?token=used-tok')
    expect(await screen.findByText(/This link has already been used or replaced/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Set your password')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(onSignIn).toHaveBeenCalledTimes(1)
  })

  it('says so when the link has no token, without asking the server', () => {
    let asked = false
    server.use(http.get(CLAIM_URL, () => { asked = true; return HttpResponse.json(preview()) }))
    renderAt('/business/claim')
    expect(screen.getByText('This link is missing its token. Ask your account manager to send a new one.')).toBeInTheDocument()
    expect(asked).toBe(false)
  })

  it("shows the server's field error and keeps the form", async () => {
    server.use(
      http.get(CLAIM_URL, () => HttpResponse.json(preview())),
      http.post(CLAIM_URL, () => HttpResponse.json({ email: ['That email already belongs to another account.'] }, { status: 400 })),
    )
    renderAt('/business/claim?token=link-tok')
    await screen.findByText('Asafo Hair & Beauty')
    fireEvent.change(screen.getByLabelText('Email (optional)'), { target: { value: 'taken@example.com' } })
    fillAndSave()
    expect(await screen.findByText('That email already belongs to another account.')).toBeInTheDocument()
    expect(screen.getByLabelText('Set your password')).toBeInTheDocument()
  })

  it('says where password resets go now, so the owner can put in their own email', async () => {
    server.use(http.get(CLAIM_URL, () => HttpResponse.json(preview())))
    renderAt('/business/claim?token=link-tok')
    expect(await screen.findByText("Password resets go to gi•••@example.com. If that isn't your email, enter yours below.")).toBeInTheDocument()
    expect(screen.getByLabelText('Email (optional)')).toHaveAttribute('autocomplete', 'email')
  })

  it('says nothing about resets when there is no email on file', async () => {
    server.use(http.get(CLAIM_URL, () => HttpResponse.json(preview({ email_on_file: null }))))
    renderAt('/business/claim?token=link-tok')
    await screen.findByText('Asafo Hair & Beauty')
    expect(screen.queryByText(/Password resets go to/)).not.toBeInTheDocument()
  })

  it.each([
    ['a server error', () => HttpResponse.json({ detail: 'Server Error' }, { status: 502 })],
    ['no connection', () => HttpResponse.error()],
  ])("offers Try again on %s, instead of calling the link unusable", async (_what, failure) => {
    let calls = 0
    server.use(http.get(CLAIM_URL, () => { calls += 1; return calls === 1 ? failure() : HttpResponse.json(preview()) }))
    renderAt('/business/claim?token=link-tok')
    expect(await screen.findByText(LOAD_PROBLEM)).toBeInTheDocument()
    expect(screen.queryByText(/This link can't be used/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Asafo Hair & Beauty')).toBeInTheDocument()
    expect(screen.getByLabelText('Set your password')).toBeInTheDocument()
  })

  it('still opens with an expired sign-in stored in this browser', async () => {
    // The server refuses any request carrying an expired token (401), even on
    // this public page: the page asks once more without it.
    setStoredAuth({ token: 'expired-token', account_type: 'customer' })
    const sentAuth = []
    server.use(http.get(CLAIM_URL, ({ request }) => {
      const auth = request.headers.get('authorization')
      sentAuth.push(auth)
      return auth ? HttpResponse.json({ detail: 'Token is invalid or expired' }, { status: 401 }) : HttpResponse.json(preview())
    }))
    renderAt('/business/claim?token=link-tok')
    expect(await screen.findByText('Asafo Hair & Beauty')).toBeInTheDocument()
    expect(sentAuth).toEqual(['Bearer expired-token', null])
    expect(getStoredAuth()).toBeNull()
  })

  it('saves the login even when an expired sign-in turns up before the claim', async () => {
    server.use(
      http.get(CLAIM_URL, () => HttpResponse.json(preview())),
      http.post(CLAIM_URL, ({ request }) => (request.headers.get('authorization')
        ? HttpResponse.json({ detail: 'Token is invalid or expired' }, { status: 401 })
        : HttpResponse.json({ claimed: true, login_phone: '+233201234761', business_name: 'Asafo Hair & Beauty' }))),
    )
    renderAt('/business/claim?token=link-tok')
    await screen.findByText('Asafo Hair & Beauty')
    setStoredAuth({ token: 'expired-token', account_type: 'customer' })
    fillAndSave()
    expect(await screen.findByText(/You're all set — sign in with \+233201234761/)).toBeInTheDocument()
  })
})
