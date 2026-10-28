import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../../../mocks/server.js'
import SecurityPolicySection from '../SecurityPolicySection.jsx'

const URL = 'http://localhost:8000/api/staff-security/policy/'
const policy = (over = {}) => ({
  roles: [
    { name: 'super_admin', label: 'Super Admin', people: 1, using: 1, required: true, locked: true },
    { name: 'support', label: 'Support', people: 4, using: 1, required: false, locked: false },
  ],
  limits: { idle_minutes: 30, absolute_hours: 12, password_window_minutes: 10 },
  password_protected: [], updated_at: null, updated_by: null, other_super_admins: 0,
  otp: { otp_customer_gap_days: 30, otp_sms_daily_alert: 500 }, ...over,
})
const GAP = 'Days a trusted customer device skips the code'
const ALERT = 'Texts a day before Super Admin is alerted'

function renderIt() {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><SecurityPolicySection /></QueryClientProvider>)
}
const otpSave = () => screen.getByRole('button', { name: 'Save code settings' })

describe('SecurityPolicySection one-time codes', () => {
  it('shows both numbers from data.otp', async () => {
    server.use(http.get(URL, () => HttpResponse.json(policy())))
    renderIt()
    expect(await screen.findByRole('heading', { name: 'One-time codes' })).toBeInTheDocument()
    expect(screen.getByLabelText(GAP)).toHaveValue(30)
    expect(screen.getByLabelText(ALERT)).toHaveValue(500)
    expect(screen.getByText(/staff and vendors always get a code/)).toBeInTheDocument()
  })

  it('saving sends only the changed key', async () => {
    let body = null
    server.use(
      http.get(URL, () => HttpResponse.json(policy())),
      http.patch(URL, async ({ request }) => { body = await request.json(); return HttpResponse.json(policy()) }),
    )
    renderIt()
    fireEvent.change(await screen.findByLabelText(GAP), { target: { value: '45' } })
    fireEvent.click(otpSave())
    await waitFor(() => expect(body).toEqual({ otp_customer_gap_days: 45 }))
  })

  it('out-of-range values are refused before sending', async () => {
    let sent = false
    server.use(http.get(URL, () => HttpResponse.json(policy())), http.patch(URL, () => { sent = true; return HttpResponse.json(policy()) }))
    renderIt()
    fireEvent.change(await screen.findByLabelText(GAP), { target: { value: '400' } })
    fireEvent.click(otpSave())
    expect(await screen.findByRole('alert')).toHaveTextContent(/between 1 and 365/)
    fireEvent.change(screen.getByLabelText(GAP), { target: { value: '30' } })
    fireEvent.change(screen.getByLabelText(ALERT), { target: { value: '0' } })
    fireEvent.click(otpSave())
    expect(await screen.findByRole('alert')).toHaveTextContent(/between 1 and 1,000,000/)
    expect(sent).toBe(false)
  })

  it('server error is shown', async () => {
    server.use(
      http.get(URL, () => HttpResponse.json(policy())),
      http.patch(URL, () => HttpResponse.json({ detail: 'Too high for now.' }, { status: 400 })),
    )
    renderIt()
    fireEvent.change(await screen.findByLabelText(ALERT), { target: { value: '900' } })
    fireEvent.click(otpSave())
    expect(await screen.findByRole('alert')).toHaveTextContent('Too high for now.')
  })

  it('the roles Save still sends only two_factor_roles', async () => {
    let body = null
    server.use(
      http.get(URL, () => HttpResponse.json(policy())),
      http.patch(URL, async ({ request }) => { body = await request.json(); return HttpResponse.json(policy()) }),
    )
    renderIt()
    fireEvent.click(await screen.findByLabelText('Require 2-step sign-in for Support'))
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(body).toEqual({ two_factor_roles: ['support'] }))
  })

  it('no section when data.otp is missing', async () => {
    const { otp, ...rest } = policy() // eslint-disable-line no-unused-vars
    server.use(http.get(URL, () => HttpResponse.json(rest)))
    renderIt()
    await screen.findByText(/Signed out after/)
    expect(screen.queryByRole('heading', { name: 'One-time codes' })).not.toBeInTheDocument()
  })
})
