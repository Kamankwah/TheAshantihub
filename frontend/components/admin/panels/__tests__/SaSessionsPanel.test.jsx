import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../../../mocks/server.js'
import SaSessionsPanel from '../SaSessionsPanel.jsx'
import { API, renderPanel } from './saTestUtils.jsx'

const s = (id, staffId, name, role, device, extra = {}) => ({
  id, staff: { id: staffId, full_name: name, role, role_label: role }, device_label: device, ip: '154.160.24.91', two_factor: false,
  created_at: '2026-10-07T07:58:00Z', last_seen_at: '2026-10-07T11:45:00Z', idle_ends_at: '2026-10-07T12:15:00Z', ends_at: '2026-10-07T19:58:00Z',
  is_current: false, new_device: false, sudo_until: null, ...extra,
})
const DATA = {
  kpis: { sessions: 3, people: 3, with_two_step: 1, new_devices_today: 1, new_device_people: ['Yaw Owusu'] },
  rules: { idle_minutes: 30, longest_hours: 12, sudo_minutes: 10, two_step_required_for: 'Super Admin' },
  sessions: [
    s(1, 1, 'Simon Peter', 'super_admin', 'Chrome on Windows computer', { is_current: true, two_factor: true, sudo_until: '2026-10-07T11:52:00Z' }),
    s(2, 2, 'Ama Boateng', 'operations', 'Chrome on Android device', { two_factor: true }),
    s(3, 4, 'Yaw Owusu', 'scout', 'Safari on iPhone', { new_device: true }),
  ],
}

function setup() {
  const seen = { posts: [] }
  server.use(
    http.get(`${API}/api/people/sessions/`, () => HttpResponse.json(DATA)),
    http.post(`${API}/api/accounts/staff/sessions/:id/end/`, ({ params }) => { seen.posts.push(['end', params.id]); return HttpResponse.json({}) }),
    http.post(`${API}/api/accounts/staff/:id/sign-out-everywhere/`, ({ params }) => { seen.posts.push(['everywhere', params.id]); return HttpResponse.json({ ended: 1 }) }),
    http.post(`${API}/api/people/sessions/sign-out-all/`, () => { seen.posts.push(['all']); return HttpResponse.json({ ended: 2, people: 2 }) }),
  )
  return seen
}

describe('SaSessionsPanel', () => {
  it('shows the KPIs from the records and the limits as the server states them', async () => {
    setup()
    renderPanel(<SaSessionsPanel />)
    const strip = await screen.findByRole('group', { name: 'Sessions summary' })
    expect(within(strip).getByText('30 min')).toBeInTheDocument()
    expect(within(strip).getByText('12 h')).toBeInTheDocument()
    expect(within(strip).getByText('Yaw Owusu')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'This session' })).toHaveTextContent(/Password re-entered: protected actions are unlocked until/)
  })

  it('never claims a network name or a location', async () => {
    setup()
    renderPanel(<SaSessionsPanel />)
    await screen.findByRole('table', { name: 'Sessions' })
    expect(screen.queryByText(/Office network|MTN|outside Ghana/i)).toBeNull()
    expect(screen.getAllByText(/Only the IP address is known|nothing is said about location/).length).toBeGreaterThan(0)
  })

  it('lists other people, with your own session kept apart, and flags a new device', async () => {
    setup()
    renderPanel(<SaSessionsPanel />)
    const table = await screen.findByRole('table', { name: 'Sessions' })
    expect(within(table).queryByText('Simon Peter')).toBeNull()
    const yaw = within(table).getByText('Yaw Owusu').closest('tr')
    expect(within(yaw).getByText('New device today')).toBeInTheDocument()
    expect(within(yaw).getByText('Password only')).toBeInTheDocument()
    expect(within(within(table).getByText('Ama Boateng').closest('tr')).getByText('2-step')).toBeInTheDocument()
  })

  it('filters by person, role, device and new devices only', async () => {
    setup()
    renderPanel(<SaSessionsPanel />)
    const table = await screen.findByRole('table', { name: 'Sessions' })
    fireEvent.click(screen.getByLabelText('Only new devices'))
    expect(within(table).queryByText('Ama Boateng')).toBeNull()
    fireEvent.click(screen.getByLabelText('Only new devices'))
    fireEvent.change(screen.getByLabelText('Device'), { target: { value: 'computer' } })
    expect(screen.getByText('No session matches these filters.')).toBeInTheDocument()
  })

  it('ends a session, signs a person out of every device and signs everyone out after confirming', async () => {
    const seen = setup()
    renderPanel(<SaSessionsPanel />)
    fireEvent.click(await screen.findByRole('button', { name: "End Ama Boateng's session on Chrome on Android device" }))
    await waitFor(() => expect(seen.posts).toContainEqual(['end', '2']))
    fireEvent.click(screen.getByRole('button', { name: "Sign out all of Yaw Owusu's devices" }))
    await waitFor(() => expect(seen.posts).toContainEqual(['everywhere', '4']))
    fireEvent.click(screen.getByRole('button', { name: 'Sign out every staff member' }))
    expect(seen.posts.some((p) => p[0] === 'all')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Sign everyone out' }))
    await waitFor(() => expect(seen.posts).toContainEqual(['all']))
    expect(await screen.findByText('Signed out 2 people (2 sessions).')).toBeInTheDocument()
  })
})
