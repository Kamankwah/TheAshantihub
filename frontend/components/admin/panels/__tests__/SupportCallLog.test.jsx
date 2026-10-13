import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { server } from '../../../../mocks/server.js'
import CallLogPanel from '../CallLogPanel.jsx'

const API = 'http://localhost:8000'
const SUPPORT = { user: { role: 'support' }, hasPermission: () => true }
const ROWS = [
  { id: 1, staff: 5, staff_name: 'Esi Nyarko', direction: 'in', counterpart_type: 'customer', counterpart_id: 11, counterpart_name: 'Akua Boakye', counterpart_phone: '055 *** 210', purpose: 'refund_return', outcome: 'connected', duration_seconds: 390, related_label: 'Order #10', follow_up_at: null, started_at: new Date().toISOString(), created_at: new Date().toISOString() },
  { id: 2, staff: 6, staff_name: 'Nana Yaa Ofori', direction: 'out', counterpart_type: 'business_owner', counterpart_id: 4, counterpart_name: 'Kejetia Phone Hub', counterpart_phone: '********860', purpose: 'business_question', outcome: 'busy', duration_seconds: 0, related_label: 'Conversation · Kwesi Amoako', follow_up_at: null, started_at: new Date().toISOString(), created_at: new Date().toISOString() },
]
const KPIS = { logged: 2, connected: 1, inbound: 1, outbound: 1, not_reached: 1, avg_connected_seconds: 236, follow_ups: 1, follow_ups_due_today: 1 }

function renderLog(props = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={queryClient}><CallLogPanel auth={SUPPORT} {...props} /></QueryClientProvider>)
}

function mockCalls(urls = []) {
  server.use(
    http.get(`${API}/api/calls/purposes/`, () => HttpResponse.json([{ value: 'order_question', label: 'Order question' }, { value: 'payment', label: 'Payment' }, { value: 'other', label: 'Other' }])),
    http.get(`${API}/api/calls/`, ({ request }) => { urls.push(new URL(request.url)); return HttpResponse.json({ count: 2, next: null, previous: null, results: ROWS, summary: { logged: 2, connected: 1 }, kpis: KPIS }) }),
  )
}

describe('Support call log', () => {
  it('shows the KPI row, the Support columns and the canvas footer', async () => {
    mockCalls()
    renderLog()
    const tiles = await screen.findByRole('group', { name: 'Calls today' })
    expect(within(tiles).getByText('2')).toBeInTheDocument()
    expect(within(screen.getByRole('group', { name: 'Not reached' })).getByText('1')).toBeInTheDocument()
    expect(within(screen.getByRole('group', { name: 'Average connected call' })).getByText('3 min 56 s')).toBeInTheDocument()
    expect(within(screen.getByRole('group', { name: 'Follow-ups set' })).getByText('1 due today')).toBeInTheDocument()
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent)
    expect(headers).toEqual(['Time', 'Direction', 'With', 'Purpose', 'Outcome', 'Length', 'Linked to', 'Logged by', 'Follow-up'])
    expect(screen.getByText('Akua Boakye')).toBeInTheDocument()
    expect(screen.getByText('Order #10')).toBeInTheDocument()
    expect(screen.getByText('No phone system is connected: every call here was typed in by the person who made or took it.')).toBeInTheDocument()
  })

  it('never offers a way to contact a business and keeps its number masked', async () => {
    mockCalls()
    renderLog()
    await screen.findByText('Kejetia Phone Hub')
    expect(screen.getByText(/Business · \*+860/)).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.queryByText(/whatsapp|wa\.me|tel:/i)).not.toBeInTheDocument()
  })

  it('filters by purpose, outcome and who logged it, and has no Promised to pay', async () => {
    const urls = []
    mockCalls(urls)
    renderLog()
    await screen.findByText('Akua Boakye')
    expect(screen.queryByRole('option', { name: 'Promised to pay' })).not.toBeInTheDocument()
    await screen.findByRole('option', { name: 'Payment' })
    fireEvent.change(screen.getByLabelText('Purpose'), { target: { value: 'payment' } })
    fireEvent.change(screen.getByLabelText('Outcome'), { target: { value: 'busy' } })
    fireEvent.change(screen.getByLabelText('Logged by'), { target: { value: 'mine' } })
    fireEvent.click(screen.getByRole('button', { name: 'Inbound' }))
    await waitFor(() => {
      const last = urls[urls.length - 1].searchParams
      expect([last.get('purpose'), last.get('outcome'), last.get('scope'), last.get('direction')]).toEqual(['payment', 'busy', 'mine', 'in'])
    })
    fireEvent.change(screen.getByLabelText('Logged by'), { target: { value: '6' } })
    await waitFor(() => expect(urls[urls.length - 1].searchParams.get('staff')).toBe('6'))
    expect(screen.getByRole('option', { name: 'Nana Yaa Ofori' })).toBeInTheDocument()
  })

  it('filters to earlier calls with one person across all dates', async () => {
    const urls = []
    mockCalls(urls)
    renderLog()
    fireEvent.click((await screen.findAllByRole('button', { name: 'Earlier calls with them' }))[0])
    await waitFor(() => {
      const last = urls[urls.length - 1].searchParams
      expect([last.get('counterpart_type'), last.get('counterpart_id'), last.get('from')]).toEqual(['customer', '11', null])
    })
    expect(screen.getByRole('status')).toHaveTextContent('Akua Boakye')
  })

  it('exports with the same filters and says the numbers are masked', async () => {
    mockCalls()
    let asked = null
    server.use(http.get(`${API}/api/calls/export/`, ({ request }) => { asked = new URL(request.url); return new HttpResponse('a,b', { headers: { 'Content-Type': 'text/csv' } }) }))
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:x')
    globalThis.URL.revokeObjectURL = vi.fn()
    renderLog()
    await screen.findByText('Akua Boakye')
    fireEvent.change(screen.getByLabelText('Outcome'), { target: { value: 'connected' } })
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }))
    expect(await screen.findByText('Exported. Numbers are masked in the file.')).toBeInTheDocument()
    expect(asked.searchParams.get('format')).toBe('csv')
    expect(asked.searchParams.get('outcome')).toBe('connected')
  })

  it('Log a call asks the shell to open the log page', async () => {
    mockCalls()
    const onLogCall = vi.fn()
    renderLog({ onLogCall })
    fireEvent.click(await screen.findByRole('button', { name: 'Log a call' }))
    expect(onLogCall).toHaveBeenCalled()
  })

  it('shows an honest empty state', async () => {
    server.use(http.get(`${API}/api/calls/`, () => HttpResponse.json({ count: 0, next: null, previous: null, results: [], summary: { logged: 0, connected: 0 }, kpis: { ...KPIS, logged: 0, connected: 0, inbound: 0, outbound: 0, not_reached: 0, avg_connected_seconds: null, follow_ups: 0, follow_ups_due_today: 0 } })))
    renderLog()
    expect(await screen.findByText('No calls logged today.')).toBeInTheDocument()
    expect(within(screen.getByRole('group', { name: 'Average connected call' })).getByText('—')).toBeInTheDocument()
  })
})
