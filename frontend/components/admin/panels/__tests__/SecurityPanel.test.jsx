import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../../../mocks/server.js'
import SecurityPanel from '../SecurityPanel.jsx'

const session = (id, overrides = {}) => ({
  id, device_label: 'Chrome on Windows computer', ip: '41.66.212.18', created_at: '2026-10-07T07:40:00Z',
  last_seen_at: '2026-10-07T11:40:00Z', ends_at: '2026-10-07T19:40:00Z', idle_ends_at: '2026-10-07T12:10:00Z',
  revoked_at: null, revoked_reason: '', is_active: true, is_current: false, two_factor: false,
  staff: { id: 1, full_name: 'Esi Nyarko', role: 'support' }, ...overrides,
})
const off = { enabled: false, required: false, enabled_at: null, recovery_codes_left: 0 }

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={queryClient}><SecurityPanel /></QueryClientProvider>)
}

describe('SecurityPanel', () => {
  it('lists my sessions and signs out the other devices', async () => {
    let endedOthers = false
    server.use(
      http.get('http://localhost:8000/api/accounts/staff/sessions/', () => HttpResponse.json([
        session(1, { is_current: true, two_factor: true }),
        session(2, { device_label: 'Chrome on Android device', ip: '154.160.24.91' }),
      ])),
      http.post('http://localhost:8000/api/accounts/staff/sessions/end-others/', () => { endedOthers = true; return HttpResponse.json({ ended: 1 }) }),
    )
    renderPanel()
    expect(await screen.findByText('This device')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'End the session on Chrome on Android device' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Sign out other devices' }))
    await waitFor(() => expect(endedOthers).toBe(true))
  })

  it('sets up 2-step sign-in and shows the recovery codes', async () => {
    let confirmed = null
    server.use(
      http.get('http://localhost:8000/api/accounts/staff/two-factor/', () => HttpResponse.json(off)),
      http.post('http://localhost:8000/api/accounts/staff/two-factor/setup/', () => HttpResponse.json({ secret: 'JBSWY3DPEHPK3PXP', otpauth_uri: 'otpauth://totp/AshantiHub:esi%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=AshantiHub' })),
      http.post('http://localhost:8000/api/accounts/staff/two-factor/setup/confirm/', async ({ request }) => {
        confirmed = await request.json()
        return HttpResponse.json({ recovery_codes: ['abcde-fghjk', 'mnpqr-stuvw'] })
      }),
    )
    renderPanel()
    fireEvent.click(await screen.findByRole('button', { name: 'Set up 2-step sign-in' }))
    fireEvent.change(await screen.findByLabelText('6-digit code from the app'), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Turn on 2-step sign-in' }))
    expect(await screen.findByRole('list', { name: 'Recovery codes' })).toHaveTextContent('abcde-fghjk')
    expect(confirmed).toEqual({ code: '123456' })
  })

  it("never offers to turn it off for a Super Admin", async () => {
    server.use(http.get('http://localhost:8000/api/accounts/staff/two-factor/', () => HttpResponse.json({ enabled: true, required: true, enabled_at: '2026-10-02T08:00:00Z', recovery_codes_left: 9 })))
    renderPanel()
    expect(await screen.findByText(/Recovery codes left: 9 of 10/)).toBeInTheDocument()
    expect(screen.getByText("2-step sign-in can't be turned off for a Super Admin.")).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Turn off' })).not.toBeInTheDocument()
  })

  it('turns 2-step off for a non-required staffer and refreshes the status', async () => {
    let enabled = true
    let disabled = 0
    server.use(
      http.get('http://localhost:8000/api/accounts/staff/two-factor/', () => HttpResponse.json({ enabled, required: false, enabled_at: '2026-10-02T08:00:00Z', recovery_codes_left: 4 })),
      http.post('http://localhost:8000/api/accounts/staff/two-factor/disable/', () => { disabled += 1; enabled = false; return new HttpResponse(null, { status: 204 }) }),
    )
    renderPanel()
    expect(await screen.findByText(/Recovery codes left: 4 of 10/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Turn off' }))
    expect(await screen.findByRole('button', { name: 'Set up 2-step sign-in' })).toBeInTheDocument()
    expect(disabled).toBe(1)
  })

  it('shows new recovery codes once, with download and copy', async () => {
    server.use(
      http.get('http://localhost:8000/api/accounts/staff/two-factor/', () => HttpResponse.json({ enabled: true, required: false, enabled_at: '2026-10-02T08:00:00Z', recovery_codes_left: 2 })),
      http.post('http://localhost:8000/api/accounts/staff/two-factor/recovery-codes/', () => HttpResponse.json({ recovery_codes: ['aaaaa-bbbbb'] })),
    )
    renderPanel()
    fireEvent.click(await screen.findByRole('button', { name: 'Make new recovery codes' }))
    expect(await screen.findByRole('list', { name: 'Recovery codes' })).toHaveTextContent('aaaaa-bbbbb')
    expect(screen.getByRole('button', { name: 'Download' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument()
  })

  it('sends the 2-step code with spaces stripped, as a string', async () => {
    let confirmed = null
    server.use(
      http.post('http://localhost:8000/api/accounts/staff/two-factor/setup/', () => HttpResponse.json({ secret: 'JBSWY3DPEHPK3PXP', otpauth_uri: 'otpauth://x' })),
      http.post('http://localhost:8000/api/accounts/staff/two-factor/setup/confirm/', async ({ request }) => { confirmed = await request.json(); return HttpResponse.json({ recovery_codes: ['a'] }) }),
    )
    renderPanel()
    fireEvent.click(await screen.findByRole('button', { name: 'Set up 2-step sign-in' }))
    fireEvent.change(await screen.findByLabelText('6-digit code from the app'), { target: { value: '123 456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Turn on 2-step sign-in' }))
    await screen.findByRole('list', { name: 'Recovery codes' })
    expect(confirmed).toEqual({ code: '123456' })
  })

  it('shows a refused action as an alert and still refreshes the sessions', async () => {
    let listed = 0
    server.use(
      http.get('http://localhost:8000/api/accounts/staff/sessions/', () => { listed += 1; return HttpResponse.json([session(1, { is_current: true }), session(2)]) }),
      http.post('http://localhost:8000/api/accounts/staff/sessions/2/end/', () => HttpResponse.json({ detail: 'Not found.' }, { status: 404 })),
    )
    renderPanel()
    fireEvent.click(await screen.findByRole('button', { name: 'End the session on Chrome on Windows computer' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Not found.')
    await waitFor(() => expect(listed).toBeGreaterThan(1))
  })

  it('says so when no other device is signed in', async () => {
    server.use(http.get('http://localhost:8000/api/accounts/staff/sessions/', () => HttpResponse.json([session(1, { is_current: true })])))
    renderPanel()
    expect(await screen.findByText('No other devices are signed in.')).toBeInTheDocument()
  })

  it('shows a loading status and a load error as an alert', async () => {
    server.use(http.get('http://localhost:8000/api/accounts/staff/sessions/', () => HttpResponse.json({ detail: 'x' }, { status: 500 })))
    renderPanel()
    expect(screen.getAllByRole('status').length).toBeGreaterThan(0)
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load your sessions.')
  })

  it('lists recent sign-ins, ended ones included, apart from the active list', async () => {
    server.use(http.get('http://localhost:8000/api/accounts/staff/sessions/', () => HttpResponse.json([
      session(1, { is_current: true }),
      session(5, { device_label: 'Firefox on Linux computer', is_active: false, revoked_at: '2026-10-06T10:00:00Z', revoked_reason: 'signed_out', created_at: '2026-10-06T08:00:00Z' }),
    ])))
    renderPanel()
    const list = await screen.findByRole('list', { name: 'Recent sign-ins' })
    expect(list).toHaveTextContent('Firefox on Linux computer')
    expect(list).toHaveTextContent('Ended: Signed out')
    // Ended rows never get an End button.
    expect(screen.queryByRole('button', { name: 'End the session on Firefox on Linux computer' })).not.toBeInTheDocument()
  })
})

