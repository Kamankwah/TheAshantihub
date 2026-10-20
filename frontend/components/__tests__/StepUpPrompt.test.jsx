import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { apiPost, setStoredAuth } from '../../apiClient.js'
import { server } from '../../mocks/server.js'
import StepUpPrompt from '../StepUpPrompt.jsx'

const BASE = 'http://localhost:8000'
const PAYOUT = `${BASE}/api/payout/destination/`
const ME = `${BASE}/api/otp/me/`
const SEND = `${BASE}/api/otp/step-up/send/`
const VERIFY = `${BASE}/api/otp/step-up/verify/`

const SMS = { channel: 'sms', hint: '0•• ••• 1234', verified: true }
const EMAIL = { channel: 'email', hint: 'a•••@x.com', verified: true }
const need = (action = 'payout_destination') => HttpResponse.json({ detail: 'A code is needed.', code: 'step_up_required', action }, { status: 403 })
const overview = (channels) => http.get(ME, () => HttpResponse.json({ channels, authenticator: null, trusted_devices: [], switches: { sign_in: true, step_up: true, sign_up: true }, customer_gap_days: 30 }))
const sent = (extra = {}) => http.post(SEND, () => HttpResponse.json({ channel: 'sms', hint: '0•• ••• 1234', expires_in: 300, resend_in: 60, ...extra }))
const err = (status, body) => HttpResponse.json(body, { status })

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><StepUpPrompt /></QueryClientProvider>)
}
// Starts a request the server refuses until the right token arrives.
function guard(tokenSeen) {
  let attempts = 0
  server.use(http.post(PAYOUT, ({ request }) => {
    attempts += 1
    const token = request.headers.get('X-Step-Up-Token')
    if (token) { tokenSeen?.push(token); return HttpResponse.json({ saved: true }) }
    return need()
  }))
  return () => attempts
}
const codeBox = () => screen.findByLabelText(/code/i)

beforeEach(() => setStoredAuth({ token: 'tok', userType: 'customer' }))
afterEach(() => { setStoredAuth(null); localStorage.clear(); sessionStorage.clear() })

describe('StepUpPrompt', () => {
  it('opens on step_up_required and names the action', async () => {
    guard(); server.use(overview([SMS, EMAIL]))
    mount()
    apiPost('/api/payout/destination/', {}).catch(() => {})
    expect(await screen.findByRole('dialog', { name: 'Change where your money is paid' })).toBeInTheDocument()
  })

  it('falls back to a generic title for an unknown action', async () => {
    server.use(http.post(PAYOUT, () => need('mystery')), overview([SMS, EMAIL]))
    mount()
    apiPost('/api/payout/destination/', {}).catch(() => {})
    expect(await screen.findByRole('dialog', { name: "Confirm it's you" })).toBeInTheDocument()
  })

  it('one channel is sent without asking', async () => {
    guard(); let sendBody = null
    server.use(overview([SMS]), http.post(SEND, async ({ request }) => { sendBody = await request.json(); return HttpResponse.json({ channel: 'sms', hint: SMS.hint, expires_in: 300, resend_in: 60 }) }))
    mount()
    apiPost('/api/payout/destination/', {}).catch(() => {})
    await codeBox()
    expect(sendBody).toEqual({ action: 'payout_destination', channel: 'sms' })
    expect(screen.getByRole('status')).toHaveTextContent('0•• ••• 1234')
    expect(screen.queryByRole('button', { name: /Text to/ })).not.toBeInTheDocument()
  })

  it('two channels let the person choose and switch', async () => {
    guard(); const channels = []
    server.use(overview([SMS, EMAIL]), http.post(SEND, async ({ request }) => {
      const b = await request.json(); channels.push(b.channel)
      return HttpResponse.json({ channel: b.channel, hint: '', expires_in: 300, resend_in: 0 })
    }))
    mount()
    apiPost('/api/payout/destination/', {}).catch(() => {})
    fireEvent.click(await screen.findByRole('button', { name: 'Email to a•••@x.com' }))
    await codeBox()
    expect(channels).toEqual(['email'])
    fireEvent.click(screen.getByRole('button', { name: 'Send by text instead' }))
    await waitFor(() => expect(channels).toEqual(['email', 'sms']))
  })

  it('a right code retries the original request with the token and resolves its result', async () => {
    const seen = []; guard(seen)
    let verifyBody = null
    server.use(overview([SMS]), sent(), http.post(VERIFY, async ({ request }) => { verifyBody = await request.json(); return HttpResponse.json({ step_up_token: 'STEPTOKEN', action: 'payout_destination', expires_in: 300 }) }))
    mount()
    const action = apiPost('/api/payout/destination/', {})
    fireEvent.change(await codeBox(), { target: { value: '123 456' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Confirm' })); await Promise.allSettled([action]) })
    await expect(action).resolves.toEqual({ saved: true })
    expect(verifyBody).toEqual({ action: 'payout_destination', code: '123456' })
    expect(seen).toEqual(['STEPTOKEN'])
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('a wrong code shows the server text and keeps the prompt open', async () => {
    guard()
    server.use(overview([SMS]), sent(), http.post(VERIFY, () => err(400, { detail: 'That code is not right. 2 tries left.', code: 'wrong_code' })))
    mount()
    apiPost('/api/payout/destination/', {}).catch(() => {})
    fireEvent.change(await codeBox(), { target: { value: '000000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('That code is not right. 2 tries left.')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByLabelText(/code/i)).toHaveValue('')
  })

  it('resend is disabled until the countdown ends', async () => {
    guard()
    server.use(overview([SMS]), sent({ resend_in: 1 }))
    mount()
    apiPost('/api/payout/destination/', {}).catch(() => {})
    await codeBox()
    const resend = screen.getByRole('button', { name: /Send a new code/ })
    expect(resend).toBeDisabled()
    expect(resend).toHaveTextContent(/0:0[01]/)
    await waitFor(() => expect(screen.getByRole('button', { name: /Send a new code/ })).toBeEnabled(), { timeout: 3000 })
  })

  it('shows retry_after seconds when a resend is too soon', async () => {
    guard(); let n = 0
    server.use(overview([SMS]), http.post(SEND, () => { n += 1; return n === 1 ? HttpResponse.json({ channel: 'sms', hint: '', expires_in: 300, resend_in: 0 }) : err(429, { detail: 'Wait a moment.', code: 'resend_cooldown', retry_after: 42 }) }))
    mount()
    apiPost('/api/payout/destination/', {}).catch(() => {})
    await codeBox()
    fireEvent.click(screen.getByRole('button', { name: /Send a new code/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/42 seconds/)
  })

  it('code_expired offers a new code', async () => {
    guard(); let sends = 0
    server.use(overview([SMS]), http.post(SEND, () => { sends += 1; return HttpResponse.json({ channel: 'sms', hint: '', expires_in: 300, resend_in: 60 }) }),
      http.post(VERIFY, () => err(400, { detail: 'That code has expired.', code: 'code_expired' })))
    mount()
    apiPost('/api/payout/destination/', {}).catch(() => {})
    fireEvent.change(await codeBox(), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('That code has expired.')
    fireEvent.click(screen.getByRole('button', { name: 'Send a new code' }))
    await waitFor(() => expect(sends).toBe(2))
    await codeBox()
  })

  it('try_later shows the lock text with no resend', async () => {
    guard()
    server.use(overview([SMS]), sent(), http.post(VERIFY, () => err(429, { detail: 'Too many wrong codes. Try again tomorrow.', code: 'try_later' })))
    mount()
    apiPost('/api/payout/destination/', {}).catch(() => {})
    fireEvent.change(await codeBox(), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many wrong codes. Try again tomorrow.')
    expect(screen.queryByRole('button', { name: /Send a new code/ })).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/code/i)).not.toBeInTheDocument()
  })

  it('offers the other way when the channel is unavailable', async () => {
    guard(); const tried = []
    server.use(overview([SMS, EMAIL]), http.post(SEND, async ({ request }) => {
      const b = await request.json(); tried.push(b.channel)
      return b.channel === 'email' ? err(400, { detail: 'We cannot email you right now.', code: 'channel_unavailable' }) : HttpResponse.json({ channel: 'sms', hint: '', expires_in: 300, resend_in: 60 })
    }))
    mount()
    apiPost('/api/payout/destination/', {}).catch(() => {})
    fireEvent.click(await screen.findByRole('button', { name: 'Email to a•••@x.com' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('We cannot email you right now.')
    fireEvent.click(screen.getByRole('button', { name: 'Text to 0•• ••• 1234' }))
    await codeBox()
    expect(tried).toEqual(['email', 'sms'])
  })

  it('otp_off says so once and resolves null', async () => {
    guard()
    server.use(overview([SMS]), http.post(SEND, () => err(409, { detail: 'off', code: 'otp_off' })))
    mount()
    const action = apiPost('/api/payout/destination/', {}).catch((e) => e)
    expect(await screen.findByText("Confirming changes with a code isn't switched on.")).toHaveAttribute('role', 'status')
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect((await action).status).toBe(403)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('cancel resolves null so the original 403 surfaces', async () => {
    const attempts = guard()
    server.use(overview([SMS]), sent())
    mount()
    const action = apiPost('/api/payout/destination/', {}).catch((e) => e)
    await codeBox()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    const failure = await action
    expect(failure.status).toBe(403)
    expect(failure.body.code).toBe('step_up_required')
    expect(attempts()).toBe(1)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('Escape cancels', async () => {
    guard(); server.use(overview([SMS]), sent())
    mount()
    const action = apiPost('/api/payout/destination/', {}).catch((e) => e)
    fireEvent.keyDown(await codeBox(), { key: 'Escape' })
    expect((await action).status).toBe(403)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('two simultaneous requests share one prompt', async () => {
    const seen = []; guard(seen)
    let sends = 0
    server.use(overview([SMS]), http.post(SEND, () => { sends += 1; return HttpResponse.json({ channel: 'sms', hint: '', expires_in: 300, resend_in: 60 }) }),
      http.post(VERIFY, () => HttpResponse.json({ step_up_token: 'T', action: 'payout_destination', expires_in: 300 })))
    mount()
    const a = apiPost('/api/payout/destination/', { n: 1 })
    const b = apiPost('/api/payout/destination/', { n: 2 })
    fireEvent.change(await codeBox(), { target: { value: '123456' } })
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Confirm' })); await Promise.allSettled([a, b]) })
    await expect(a).resolves.toEqual({ saved: true })
    await expect(b).resolves.toEqual({ saved: true })
    expect(sends).toBe(1)
    expect(seen).toEqual(['T', 'T'])
  })

  it('unmounting cancels a prompt that is open', async () => {
    guard(); server.use(overview([SMS]), sent())
    const view = mount()
    const action = apiPost('/api/payout/destination/', {}).catch((e) => e)
    await codeBox()
    view.unmount()
    expect((await action).status).toBe(403)
  })

  it('returns focus to the opener', async () => {
    guard(); server.use(overview([SMS]), sent())
    const opener = document.createElement('button'); document.body.appendChild(opener); opener.focus()
    mount()
    apiPost('/api/payout/destination/', {}).catch(() => {})
    await codeBox()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(opener).toHaveFocus())
    opener.remove()
  })

  it('moves focus to the code field and sets the code field attributes', async () => {
    guard(); server.use(overview([SMS]), sent())
    mount()
    apiPost('/api/payout/destination/', {}).catch(() => {})
    const box = await codeBox()
    await waitFor(() => expect(box).toHaveFocus())
    expect(box).toHaveAttribute('inputmode', 'numeric')
    expect(box).toHaveAttribute('autocomplete', 'one-time-code')
    expect(box).toHaveAttribute('maxlength', '7')
  })

  it('no code or token is written to localStorage or sessionStorage', async () => {
    guard()
    server.use(overview([SMS]), sent(), http.post(VERIFY, () => HttpResponse.json({ step_up_token: 'SECRETTOKEN', action: 'payout_destination', expires_in: 300 })))
    mount()
    const action = apiPost('/api/payout/destination/', {})
    fireEvent.change(await codeBox(), { target: { value: '654321' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Confirm' })); await Promise.allSettled([action]) })
    await action
    const dump = JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage })
    expect(dump).not.toContain('654321')
    expect(dump).not.toContain('SECRETTOKEN')
  })
})
