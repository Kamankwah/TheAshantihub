import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../../../mocks/server.js'
import CallLogPanel from '../CallLogPanel.jsx'

const API = 'http://localhost:8000'
const SCOUT = { user: { id: 7, full_name: 'Kwame Asante', role: 'scout' }, hasPermission: () => true }
const call = (over = {}) => ({
  id: 1, direction: 'out', channel: 'phone', counterpart_type: 'business_owner', counterpart_name: 'Adwoa Frimpong', related_label: 'Asafo Hair Studio',
  purpose: 'other', outcome: 'connected', sentiment: '', notes: '', started_at: new Date().toISOString(), duration_seconds: 360,
  follow_up_at: null, created_at: new Date().toISOString(), ...over,
})

function renderPanel(auth = SCOUT) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={queryClient}><CallLogPanel auth={auth} /></QueryClientProvider>)
}

describe('CallLogPanel — the scout layout', () => {
  it("shows today's count line and a row per call with its outcome chip", async () => {
    const asked = []
    server.use(http.get(`${API}/api/calls/`, ({ request }) => {
      asked.push(new URL(request.url).search)
      return HttpResponse.json({
        count: 2, next: null, previous: null, summary: { logged: 7, connected: 4 },
        results: [call(), call({ id: 2, direction: 'in', counterpart_name: "Nana's", related_label: "Nana's Chop Bar", outcome: 'callback_requested', duration_seconds: 0 })],
      })
    }))
    renderPanel()
    expect(screen.getByRole('heading', { name: 'Calls' })).toBeInTheDocument()
    expect(await screen.findByText('Today · 7 logged · 4 connected')).toBeInTheDocument()
    expect(asked[0]).toBe('?day=today')
    const first = screen.getByRole('button', { name: 'Edit call with Asafo Hair Studio' })
    expect(within(first).getByText(/^Out · \d\d:\d\d · 6 min$/)).toBeInTheDocument()
    expect(within(first).getByText('Connected')).toBeInTheDocument()
    const second = screen.getByRole('button', { name: "Edit call with Nana's Chop Bar" })
    expect(within(second).getByText(/^In · \d\d:\d\d$/)).toBeInTheDocument()
    expect(within(second).getByText('Callback requested')).toBeInTheDocument()
  })

  it('says so on a quiet day', async () => {
    server.use(http.get(`${API}/api/calls/`, () => HttpResponse.json({ count: 0, next: null, previous: null, summary: { logged: 0, connected: 0 }, results: [] })))
    renderPanel()
    expect(await screen.findByText('No calls logged today.')).toBeInTheDocument()
    expect(screen.getByText('Today · 0 logged · 0 connected')).toBeInTheDocument()
  })

  it('opens an own call under 24 hours old for editing, and a day-old one is read-only', async () => {
    server.use(
      http.get(`${API}/api/calls/`, () => HttpResponse.json({
        count: 2, next: null, previous: null, summary: { logged: 2, connected: 2 },
        results: [call(), call({ id: 2, related_label: 'Old Call', created_at: new Date(Date.now() - 30 * 3600000).toISOString() })],
      })),
      http.get(`${API}/api/calls/purposes/`, () => HttpResponse.json([{ value: 'other', label: 'Other' }])),
    )
    let patched = null
    server.use(http.patch(`${API}/api/calls/1/`, async ({ request }) => { patched = await request.json(); return HttpResponse.json({ id: 1 }) }))
    renderPanel()
    expect(await screen.findByText('Old Call')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit call with Old Call' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Edit call with Asafo Hair Studio' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit call' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Voicemail' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save call' }))
    await waitFor(() => expect(patched).toMatchObject({ outcome: 'voicemail' }))
    expect(await screen.findByText('Call updated.')).toBeInTheDocument()
  })

  it('opens the Log a call sheet', async () => {
    server.use(http.get(`${API}/api/calls/`, () => HttpResponse.json({ count: 0, next: null, previous: null, summary: { logged: 0, connected: 0 }, results: [] })))
    renderPanel()
    fireEvent.click(await screen.findByRole('button', { name: 'Log a call' }))
    expect(await screen.findByRole('dialog', { name: 'Log a call' })).toBeInTheDocument()
  })

  it('leaves every other role on the desk form', async () => {
    renderPanel({ user: { id: 2, role: 'support' }, hasPermission: () => true })
    expect(await screen.findByText('Call Log')).toBeInTheDocument()
  })

  it('lists only earlier calls that can still be edited', async () => {
    server.use(
      http.get(`${API}/api/calls/`, ({ request }) => {
        const today = new URL(request.url).searchParams.get('day') === 'today'
        const results = today
          ? [call()]
          : [call(), call({ id: 5, related_label: 'Yesterday Call', created_at: new Date(Date.now() - 20 * 3600000).toISOString() }),
            call({ id: 6, related_label: 'Ancient Call', created_at: new Date(Date.now() - 80 * 3600000).toISOString() })]
        return HttpResponse.json({ count: results.length, next: null, previous: null, summary: { logged: 1, connected: 1 }, results })
      }),
      http.get(`${API}/api/calls/purposes/`, () => HttpResponse.json([{ value: 'other', label: 'Other' }])),
    )
    renderPanel()
    fireEvent.click(await screen.findByRole('button', { name: 'Show earlier calls you can still edit' }))
    expect(await screen.findByText('Yesterday Call')).toBeInTheDocument()
    expect(screen.queryByText('Ancient Call')).not.toBeInTheDocument()
    expect(screen.getByText('Earlier · last 24 hours')).toBeInTheDocument()
  })
})
