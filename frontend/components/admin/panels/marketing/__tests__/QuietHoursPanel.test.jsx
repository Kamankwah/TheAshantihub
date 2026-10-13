import { fireEvent, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../../../../mocks/server.js'
import QuietHoursPanel from '../QuietHoursPanel.jsx'
import { API, renderMk } from './mkTestUtils.jsx'

const policy = (over = {}) => ({
  policy: { window_start: '08:00', window_end: '19:00', send_days: [0, 1, 2, 3, 4, 5], send_day_names: [], per_person_cap_days: 3, quiet_public_holidays: true, timezone: 'Africa/Accra' },
  threshold: '25.00', threshold_meta: { updated_at: null, updated_by: null }, pending: null, history: [], can_propose: true,
  weekday_names: [], limits: { earliest: '06:00', latest: '21:00', max_cap_days: 30 }, ...over,
})

describe('QuietHoursPanel', () => {
  it('shows the rules in force, the read-only threshold and an honest empty history', async () => {
    server.use(http.get(`${API}/api/marketing/policy/`, () => HttpResponse.json(policy())))
    renderMk(QuietHoursPanel, { permissions: ['campaigns.manage'] })
    expect(await screen.findByLabelText('From')).toHaveValue('08:00')
    expect(screen.getByLabelText('Until')).toHaveValue('19:00')
    expect(screen.getByLabelText('Sun · quiet')).not.toBeChecked()
    expect(screen.getByLabelText('Mon')).toBeChecked()
    expect(screen.getByLabelText('Days between marketing messages')).toHaveValue(3)
    expect(screen.getByText('GH₵ 25.00')).toBeInTheDocument()
    expect(screen.getByText(/Default limit/)).toBeInTheDocument()
    expect(screen.getByText(/No change has been made yet/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Propose changes' })).toBeDisabled()
  })

  it('sends a proposal with the edited values', async () => {
    let body = null
    server.use(
      http.get(`${API}/api/marketing/policy/`, () => HttpResponse.json(policy())),
      http.post(`${API}/api/marketing/policy/`, async ({ request }) => { body = await request.json(); return HttpResponse.json({ approval_id: 5, status: 'pending' }, { status: 201 }) }),
    )
    renderMk(QuietHoursPanel, { permissions: ['campaigns.manage'] })
    fireEvent.change(await screen.findByLabelText('From'), { target: { value: '09:00' } })
    fireEvent.click(screen.getByLabelText('Sat'))
    fireEvent.change(screen.getByLabelText('Days between marketing messages'), { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Propose changes' }))
    await waitFor(() => expect(body).toEqual({ window_start: '09:00', window_end: '19:00', send_days: [0, 1, 2, 3, 4], per_person_cap_days: 5, quiet_public_holidays: true }))
    expect(await screen.findByText(/Sent to Super Admin/)).toBeInTheDocument()
  })

  it("shows the server's refusal", async () => {
    server.use(
      http.get(`${API}/api/marketing/policy/`, () => HttpResponse.json(policy())),
      http.post(`${API}/api/marketing/policy/`, () => HttpResponse.json({ detail: 'The window must end after it starts.' }, { status: 400 })),
    )
    renderMk(QuietHoursPanel, { permissions: ['campaigns.manage'] })
    fireEvent.change(await screen.findByLabelText('Until'), { target: { value: '07:00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Propose changes' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('The window must end after it starts.')
  })

  it('locks the form while a proposal waits and for people who cannot propose', async () => {
    server.use(http.get(`${API}/api/marketing/policy/`, () => HttpResponse.json(policy({
      can_propose: false, pending: { id: 3, title: 'x', maker: 'Akua Sarpong', created_at: '2026-10-12T09:00:00Z', payload: {} },
      history: [{ at: '2026-10-01T09:00:00Z', kind: 'rejected', who: 'Akua Sarpong', after: { window_start: '09:00', window_end: '18:00', send_days: [0, 1], per_person_cap_days: 5, quiet_public_holidays: false }, note: 'Keep three days.' }],
    }))))
    renderMk(QuietHoursPanel, { permissions: [] })
    expect(await screen.findByLabelText('From')).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Propose changes' })).not.toBeInTheDocument()
    expect(screen.getByText(/Akua Sarpong proposed a change on/)).toBeInTheDocument()
    expect(screen.getByText(/Super Admin declined it: "Keep three days."/)).toBeInTheDocument()
  })
})
