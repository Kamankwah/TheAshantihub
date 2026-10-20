import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setStoredAuth } from '../../../apiClient.js'
import { DEVICE_KEY } from '../../../lib/otp.js'
import { server } from '../../../mocks/server.js'
import StepUpPrompt from '../../StepUpPrompt.jsx'
import AccountSecurityCard from '../AccountSecurityCard.jsx'

const BASE = 'http://localhost:8000'
const ME = `${BASE}/api/otp/me/`
const AUTH = `${BASE}/api/otp/authenticator/`
const SMS = { channel: 'sms', hint: '0•• ••• 1234', verified: true }
const EMAIL = { channel: 'email', hint: 'a•••@x.com', verified: false }
const DEVICE = { id: 7, label: 'Chrome on Android', trusted_since: '2026-10-01T10:00:00Z', last_code_at: '2026-10-02T10:00:00Z', last_seen_at: null }
const overview = (over = {}) => http.get(ME, () => HttpResponse.json({
  channels: [SMS, EMAIL], authenticator: null, trusted_devices: [], switches: { sign_in: true, step_up: true, sign_up: true }, customer_gap_days: 30, ...over,
}))
const status = (over = {}) => http.get(AUTH, () => HttpResponse.json({ enabled: false, enabled_at: null, recovery_codes_left: 0, available: true, ...over }))
const CODES = ['aaaa-1111', 'bbbb-2222']

function mount(accountType = 'customer', withPrompt = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><AccountSecurityCard accountType={accountType} />{withPrompt && <StepUpPrompt />}</QueryClientProvider>)
}

beforeEach(() => setStoredAuth({ token: 'tok', userType: 'customer' }))
afterEach(() => { setStoredAuth(null); localStorage.clear(); sessionStorage.clear() })

describe('AccountSecurityCard overview', () => {
  it('lists channels with hints and confirmed state', async () => {
    server.use(overview(), status())
    mount()
    expect(await screen.findByText('0•• ••• 1234')).toBeInTheDocument()
    expect(screen.getByText('a•••@x.com')).toBeInTheDocument()
    expect(screen.getByText('Confirmed')).toBeInTheDocument()
    expect(screen.getByText('Not confirmed')).toBeInTheDocument()
  })

  it('says when nothing is on file', async () => {
    server.use(overview({ channels: [] }), status())
    mount()
    expect(await screen.findByText('No phone or email on file. Contact AshantiHub Support.')).toBeInTheDocument()
  })

  it('states that sign-in codes are not switched on when the switch is off', async () => {
    server.use(overview({ switches: { sign_in: false, step_up: false, sign_up: false } }), status())
    mount()
    expect(await screen.findByText('Sign-in codes are not switched on yet.')).toBeInTheDocument()
  })
})

describe('AccountSecurityCard states', () => {
  it('renders nothing, and no alert, without a stored session', async () => {
    setStoredAuth(null)
    const { container } = mount()
    await new Promise((r) => setTimeout(r, 50))
    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('keeps the content and the authenticator section when a refetch fails', async () => {
    let fail = false
    server.use(
      http.get(ME, () => (fail ? HttpResponse.json({ detail: 'x' }, { status: 500 }) : HttpResponse.json({ channels: [SMS], authenticator: null, trusted_devices: [], switches: { sign_in: true, step_up: true, sign_up: true }, customer_gap_days: 30 }))),
      status(),
      http.post(`${BASE}/api/otp/authenticator/setup/`, () => HttpResponse.json({ secret: 'JBSWY3DPEHPK3PXP', otpauth_uri: 'otpauth://totp/AshantiHub:x?secret=JBSWY3DPEHPK3PXP' })),
    )
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={client}><AccountSecurityCard accountType="customer" /></QueryClientProvider>)
    fireEvent.click(await screen.findByRole('button', { name: 'Set up' }))
    await screen.findByLabelText('6-digit code from the app')
    fail = true
    await client.refetchQueries({ queryKey: ['otp', 'me'] })
    await waitFor(() => expect(client.getQueryState(['otp', 'me']).status).toBe('error'))
    expect(screen.getByLabelText('6-digit code from the app')).toBeInTheDocument()
    expect(screen.getByText('0•• ••• 1234')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('trusted devices', () => {
  it('lists trusted devices with dates and no this-device marker', async () => {
    server.use(overview({ trusted_devices: [DEVICE] }), status())
    mount()
    expect(await screen.findByText('Chrome on Android')).toBeInTheDocument()
    expect(screen.getByText(`Trusted since ${new Date(DEVICE.trusted_since).toLocaleString('en-GH')}`)).toBeInTheDocument()
    expect(screen.getByText(`Last code ${new Date(DEVICE.last_code_at).toLocaleString('en-GH')}`)).toBeInTheDocument()
    expect(screen.queryByText(/Last seen/)).not.toBeInTheDocument()
    expect(screen.queryByText(/this device/i)).not.toBeInTheDocument()
  })

  it('uses customer_gap_days from the response', async () => {
    server.use(overview({ customer_gap_days: 45, trusted_devices: [DEVICE] }), status())
    mount()
    expect(await screen.findByText(/skips the code for/)).toHaveTextContent('A trusted device skips the code for 45 days.')
  })

  it('says so when a customer has no devices', async () => {
    server.use(overview(), status())
    mount()
    expect(await screen.findByText('No trusted devices.')).toBeInTheDocument()
  })

  it('Remove posts to the device url and refetches', async () => {
    let devices = [DEVICE]; let removed = null
    server.use(
      http.get(ME, () => HttpResponse.json({ channels: [SMS], authenticator: null, trusted_devices: devices, switches: { sign_in: true, step_up: true, sign_up: true }, customer_gap_days: 30 })),
      http.post(`${BASE}/api/otp/devices/7/remove/`, () => { removed = true; devices = []; return new HttpResponse(null, { status: 204 }) }),
      status(),
    )
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Remove Chrome on Android' }))
    expect(await screen.findByText('No trusted devices.')).toBeInTheDocument()
    expect(removed).toBe(true)
  })

  it('Remove all clears the stored device token', async () => {
    localStorage.setItem(DEVICE_KEY, 'dev-secret')
    server.use(overview({ trusted_devices: [DEVICE] }), status(), http.post(`${BASE}/api/otp/devices/remove-all/`, () => HttpResponse.json({ removed: 2 })))
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Remove all' }))
    expect(screen.getByText('Are you sure?')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Yes, remove all' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Removed 2 devices. You will be asked for a code next time.')
    expect(localStorage.getItem(DEVICE_KEY)).toBeNull()
  })

  it('an owner with no devices sees no device list', async () => {
    server.use(overview(), status())
    mount('business_owner')
    await screen.findByText('0•• ••• 1234')
    expect(screen.queryByText('Trusted devices')).not.toBeInTheDocument()
    expect(screen.queryByText('No trusted devices.')).not.toBeInTheDocument()
  })
})

describe('authenticator settings', () => {
  const setupHandlers = (hits = {}) => [
    http.post(`${BASE}/api/otp/authenticator/setup/`, () => { hits.setup = true; return HttpResponse.json({ secret: 'JBSWY3DPEHPK3PXP', otpauth_uri: 'otpauth://totp/AshantiHub:x?secret=JBSWY3DPEHPK3PXP' }) }),
    http.post(`${BASE}/api/otp/authenticator/setup/confirm/`, async ({ request }) => {
      const body = await request.json(); hits.confirm = body
      if (body.code !== '123456') return HttpResponse.json({ detail: 'That code is not right.', code: 'wrong_code' }, { status: 400 })
      return HttpResponse.json({ recovery_codes: CODES })
    }),
  ]
  const typeCode = async (value) => {
    const box = await screen.findByLabelText('6-digit code from the app')
    fireEvent.change(box, { target: { value } })
    fireEvent.click(screen.getByRole('button', { name: 'Turn on 2-step sign-in' }))
  }

  it('off and available: setup walks start, QR, confirm, recovery codes once', async () => {
    const hits = {}; let enabled = false
    server.use(overview(), http.get(AUTH, () => HttpResponse.json({ enabled, enabled_at: enabled ? '2026-10-19T08:00:00Z' : null, recovery_codes_left: enabled ? 2 : 0, available: true })), ...setupHandlers(hits))
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Set up' }))
    expect(await screen.findByRole('img', { name: 'QR code for your authenticator app' })).toBeInTheDocument()
    expect(screen.getByText('JBSW Y3DP EHPK 3PXP')).toBeInTheDocument()
    enabled = true
    await typeCode('123 456')
    await waitFor(() => expect(hits.confirm).toEqual({ code: '123456' }))
    expect(await screen.findByRole('list', { name: 'Recovery codes' })).toHaveTextContent('aaaa-1111')
    fireEvent.click(screen.getByLabelText("I've saved these codes"))
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(await screen.findByText(/recovery codes left/)).toHaveTextContent('2 recovery codes left.')
    expect(screen.queryByRole('list', { name: 'Recovery codes' })).not.toBeInTheDocument()
  })

  it('setup asks for a code through the step-up prompt (retry carries X-Step-Up-Token)', async () => {
    let seen = null; let attempts = 0
    server.use(
      overview({ channels: [SMS] }), status(),
      http.post(`${BASE}/api/otp/step-up/send/`, () => HttpResponse.json({ channel: 'sms', hint: SMS.hint, expires_in: 300, resend_in: 60 })),
      http.post(`${BASE}/api/otp/step-up/verify/`, () => HttpResponse.json({ step_up_token: 'su-token', action: 'authenticator_change', expires_in: 300 })),
      http.post(`${BASE}/api/otp/authenticator/setup/`, ({ request }) => {
        attempts += 1; seen = request.headers.get('X-Step-Up-Token')
        if (!seen) return HttpResponse.json({ detail: 'A code is needed.', code: 'step_up_required', action: 'authenticator_change' }, { status: 403 })
        return HttpResponse.json({ secret: 'JBSWY3DPEHPK3PXP', otpauth_uri: 'otpauth://totp/AshantiHub:x?secret=JBSWY3DPEHPK3PXP' })
      }),
    )
    mount('customer', true)
    fireEvent.click(await screen.findByRole('button', { name: 'Set up' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(await within(dialog).findByLabelText(/code/i), { target: { value: '654321' } })
    fireEvent.submit(within(dialog).getByLabelText(/code/i).closest('form'))
    expect(await screen.findByLabelText('6-digit code from the app')).toBeInTheDocument()
    expect(seen).toBe('su-token')
    expect(attempts).toBe(2)
  })

  it('a cancelled step-up prompt shows nothing new', async () => {
    server.use(overview(), status(), http.post(`${BASE}/api/otp/authenticator/setup/`, () => HttpResponse.json({ detail: 'A code is needed.', code: 'step_up_required', action: 'authenticator_change' }, { status: 403 })))
    server.use(http.post(`${BASE}/api/otp/step-up/send/`, () => HttpResponse.json({ channel: 'sms', hint: SMS.hint, expires_in: 300, resend_in: 60 })))
    mount('customer', true)
    fireEvent.click(await screen.findByRole('button', { name: 'Set up' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Set up' })).not.toBeDisabled())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('not available shows the limitation and no button', async () => {
    server.use(overview(), status({ available: false }))
    mount()
    expect(await screen.findByText("The authenticator app isn't available for this account yet.")).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Set up' })).not.toBeInTheDocument()
  })

  it('shows the server text when the app is off at the server', async () => {
    server.use(overview(), status(), http.post(`${BASE}/api/otp/authenticator/setup/`, () => HttpResponse.json({ detail: 'Codes are not switched on.', code: 'otp_off' }, { status: 409 })))
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Set up' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Codes are not switched on.')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Set up' })).not.toBeDisabled())
  })

  it('enabled but not available still offers new codes and turn off', async () => {
    server.use(overview(), status({ enabled: true, enabled_at: '2026-10-19T08:00:00Z', recovery_codes_left: 8, available: false }))
    mount()
    expect(await screen.findByText(/recovery codes left/)).toHaveTextContent(`On since ${new Date('2026-10-19T08:00:00Z').toLocaleString('en-GH')}. 8 recovery codes left.`)
    expect(screen.getByRole('button', { name: 'New recovery codes' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Turn off' })).toBeInTheDocument()
    expect(screen.getByText('Turning it on or off asks for a code first.')).toBeInTheDocument()
  })

  it('new recovery codes are shown once', async () => {
    server.use(overview(), status({ enabled: true, enabled_at: '2026-10-19T08:00:00Z', recovery_codes_left: 3 }), http.post(`${BASE}/api/otp/authenticator/recovery-codes/`, () => HttpResponse.json({ recovery_codes: CODES })))
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'New recovery codes' }))
    expect(await screen.findByRole('list', { name: 'Recovery codes' })).toHaveTextContent('bbbb-2222')
    fireEvent.click(screen.getByLabelText("I've saved these codes"))
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    await screen.findByRole('button', { name: 'Turn off' })
    expect(screen.queryByText('bbbb-2222')).not.toBeInTheDocument()
  })

  it('turn off confirms then posts disable', async () => {
    let on = true; let disabled = 0
    server.use(overview(), http.get(AUTH, () => HttpResponse.json({ enabled: on, enabled_at: '2026-10-19T08:00:00Z', recovery_codes_left: 3, available: true })), http.post(`${BASE}/api/otp/authenticator/disable/`, () => { disabled += 1; on = false; return new HttpResponse(null, { status: 204 }) }))
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Turn off' }))
    expect(disabled).toBe(0)
    fireEvent.click(screen.getByRole('button', { name: 'Yes, turn off' }))
    expect(await screen.findByRole('button', { name: 'Set up' })).toBeInTheDocument()
    expect(disabled).toBe(1)
    expect(screen.getByRole('status')).toHaveTextContent('The authenticator app is off.')
  })

  it('wrong first code shows the server text', async () => {
    server.use(overview(), status(), ...setupHandlers())
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Set up' }))
    await typeCode('000000')
    expect(await screen.findByRole('alert')).toHaveTextContent('That code is not right.')
    expect(screen.getByLabelText('6-digit code from the app')).toBeInTheDocument()
  })

  it('secrets are not kept after Done', async () => {
    const spy = vi.spyOn(console, 'log')
    server.use(overview(), status(), ...setupHandlers())
    const { container } = mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Set up' }))
    await typeCode('123456')
    await screen.findByRole('list', { name: 'Recovery codes' })
    fireEvent.click(screen.getByLabelText("I've saved these codes"))
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    await screen.findByRole('button', { name: 'Set up' })
    expect(container.textContent).not.toContain('aaaa-1111')
    expect(container.textContent).not.toContain('JBSW')
    expect(JSON.stringify({ ...localStorage })).not.toMatch(/aaaa-1111|JBSWY3DP/)
    expect(JSON.stringify({ ...sessionStorage })).not.toMatch(/aaaa-1111|JBSWY3DP/)
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})
