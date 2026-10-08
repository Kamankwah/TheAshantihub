import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { server } from '../../../../mocks/server.js'
import SessionsPanel from '../SessionsPanel.jsx'

const session = (id, staff, overrides = {}) => ({
  id, device_label: 'Chrome on Android device', ip: '154.160.24.91', created_at: '2026-10-07T07:58:00Z',
  last_seen_at: '2026-10-07T11:45:00Z', ends_at: '2026-10-07T19:58:00Z', idle_ends_at: '2026-10-07T12:15:00Z',
  revoked_at: null, revoked_reason: '', is_active: true, is_current: false, two_factor: false, staff, ...overrides,
})
const simon = { id: 1, full_name: 'Simon Peter', role: 'super_admin' }
const ama = { id: 2, full_name: 'Ama Boateng', role: 'operations' }

describe('SessionsPanel', () => {
  it("lists everyone signed in and signs a person out of every device", async () => {
    let signedOut = null
    server.use(
      http.get('http://localhost:8000/api/accounts/staff/sessions/active/', () => HttpResponse.json([
        session(1, simon, { is_current: true, device_label: 'Chrome on Windows computer', two_factor: true }),
        session(2, ama), session(3, ama, { device_label: 'Edge on Windows computer' }),
      ])),
      http.post('http://localhost:8000/api/accounts/staff/2/sign-out-everywhere/', () => { signedOut = 2; return HttpResponse.json({ ended: 2 }) }),
    )
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={queryClient}><SessionsPanel /></QueryClientProvider>)
    expect(await screen.findByText('3 sessions on 2 people\'s devices')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Sign out all of Simon Peter\'s devices' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Sign out all of Ama Boateng\'s devices' }))
    await waitFor(() => expect(signedOut).toBe(2))
  })

  function renderPanel() {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={queryClient}><SessionsPanel /></QueryClientProvider>)
    return queryClient
  }

  it('says so when nobody is signed in', async () => {
    renderPanel()
    expect(await screen.findByText('Nobody is signed in right now.')).toBeInTheDocument()
  })

  it("ends one session, refreshes the lists, and disables the button while it runs", async () => {
    let ended = 0
    let listed = 0
    let release
    server.use(
      http.get('http://localhost:8000/api/accounts/staff/sessions/active/', () => { listed += 1; return HttpResponse.json([session(1, simon, { is_current: true }), session(2, ama)]) }),
      http.post('http://localhost:8000/api/accounts/staff/sessions/2/end/', async () => { ended += 1; await new Promise((r) => { release = r }); return HttpResponse.json({}) }),
    )
    const queryClient = renderPanel()
    const spy = vi.spyOn(queryClient, 'invalidateQueries')
    const button = await screen.findByRole('button', { name: "End Ama Boateng's session on Chrome on Android device" })
    fireEvent.click(button)
    await waitFor(() => expect(button).toBeDisabled())
    fireEvent.click(button)
    release()
    await waitFor(() => expect(listed).toBeGreaterThan(1))
    expect(ended).toBe(1)
    expect(spy).toHaveBeenCalledWith({ queryKey: ['my-sessions'] })
  })

  it('shows a refusal as an alert and still refreshes', async () => {
    let listed = 0
    server.use(
      http.get('http://localhost:8000/api/accounts/staff/sessions/active/', () => { listed += 1; return HttpResponse.json([session(1, simon, { is_current: true }), session(2, ama)]) }),
      http.post('http://localhost:8000/api/accounts/staff/2/sign-out-everywhere/', () => HttpResponse.json({ detail: 'You cannot do that.' }, { status: 403 })),
    )
    renderPanel()
    fireEvent.click(await screen.findByRole('button', { name: "Sign out all of Ama Boateng's devices" }))
    expect(await screen.findByRole('alert')).toHaveTextContent('You cannot do that.')
    await waitFor(() => expect(listed).toBeGreaterThan(1))
  })
})

