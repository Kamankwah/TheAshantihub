import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { server } from '../../../../mocks/server.js'
import ClientListingsPanel from '../ClientListingsPanel.jsx'

vi.mock('../../../../hooks/useDevicePosition.js', () => ({
  useDevicePosition: () => ({ position: null, error: null, locating: false, locate: vi.fn() }),
}))

const API = 'http://localhost:8000'
const SCOUT = { user: { id: 7, full_name: 'Kwame Asante', role: 'scout' }, hasPermission: () => true }
const OPS = { user: { id: 2, full_name: 'Ama Boateng', role: 'operations' }, hasPermission: () => true }
const conf = (o = {}) => ({ state: 'draft', sent_to_masked: '', sent_at: null, expires_at: null, send_note: '', ...o })
const draft = (id, name, over = {}, c = {}) => ({
  id, kind: 'product', name, payload: { name }, status: c.state || 'draft', created_by_id: 7, created_by_name: 'Kwame Asante',
  created_at: '2026-10-19T10:00:00Z', updated_at: '2026-10-19T10:00:00Z', confirmation: conf(c), ...over,
})
const SENT = { state: 'awaiting_owner', sent_to_masked: '024 *** 1234', sent_at: '2026-10-19T10:05:00Z', expires_at: '2026-10-26T10:05:00Z', send_note: 'Text sent' }
const DRAFTS = [
  draft(1, 'Unsent skirt'),
  draft(2, 'Awaiting hat', {}, SENT),
  draft(3, 'Lapsed shoes', {}, { ...SENT, state: 'lapsed' }),
  draft(4, 'Confirmed bag', {}, { state: 'owner_confirmed', sent_to_masked: '024 *** 1234', sent_at: SENT.sent_at, expires_at: SENT.expires_at, send_note: 'Text sent' }),
  draft(5, 'Simulated belt', {}, { state: 'awaiting_owner', sent_to_masked: '024 *** 1234', send_note: 'Not sent: texts are simulated', expires_at: SENT.expires_at }),
]

function renderPanel(auth = SCOUT, list = DRAFTS) {
  server.use(
    http.get(`${API}/api/portfolio/businesses/12/drafts/`, () => HttpResponse.json(list)),
    http.get(`${API}/api/portfolio/businesses/12/`, () => HttpResponse.json({ id: 12, business_name: 'Adwoa Fabrics', owner_name: 'Adwoa Frimpong' })),
  )
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <ClientListingsPanel businessId="12" auth={auth} onBack={() => {}} />
    </QueryClientProvider>,
  )
}
const rowOf = async (name) => (await screen.findByText(name)).closest('li')

describe('ClientListingsPanel', () => {
  it('shows the masked number and expiry for an awaiting draft', async () => {
    renderPanel()
    const row = await rowOf('Awaiting hat')
    expect(row).toHaveTextContent('Text sent to 024 *** 1234 on 19 Oct, expires 26 Oct')
  })

  it('offers Resend on a lapsed draft', async () => {
    renderPanel()
    const row = await rowOf('Lapsed shoes')
    expect(row).toHaveTextContent('Link expired')
    expect(within(row).getByRole('button', { name: 'Resend' })).toBeInTheDocument()
  })

  it('says Waiting for approval once the owner confirmed', async () => {
    renderPanel()
    expect(await rowOf('Confirmed bag')).toHaveTextContent('Waiting for approval')
  })

  it('does not claim a text went out when texts are simulated', async () => {
    renderPanel()
    const row = await rowOf('Simulated belt')
    expect(row).toHaveTextContent('Not sent: texts are simulated')
    expect(row).not.toHaveTextContent('Text sent to')
  })

  it('never shows a token, link or address', async () => {
    const { container } = renderPanel()
    await rowOf('Awaiting hat')
    expect(container.querySelector('a[href]')).toBeNull()
    expect(screen.queryByRole('button', { name: /copy/i })).toBeNull()
    expect(container.textContent).not.toMatch(/token|http|whatsapp/i)
  })

  it('shows Operations the same drafts, with Edit only on their own', async () => {
    renderPanel(OPS, [draft(1, 'Scout draft'), draft(2, 'Ops draft', { created_by_id: 2, created_by_name: 'Ama Boateng' })])
    const theirs = await rowOf('Scout draft')
    const mine = await rowOf('Ops draft')
    expect(theirs).toHaveTextContent('Kwame Asante')
    expect(within(theirs).queryByRole('button', { name: 'Edit' })).toBeNull()
    expect(within(theirs).getByRole('button', { name: 'Withdraw' })).toBeInTheDocument()
    expect(within(mine).getByRole('button', { name: 'Edit' })).toBeInTheDocument()
  })

  it('shows actionError when a resend fails', async () => {
    server.use(http.post(`${API}/api/portfolio/businesses/12/drafts/3/resend/`, () => HttpResponse.json({ detail: 'Three texts a day is the limit.' }, { status: 429 })))
    renderPanel()
    fireEvent.click(within(await rowOf('Lapsed shoes')).getByRole('button', { name: 'Resend' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Three texts a day is the limit.')
  })

  it('sends every unsent draft in one text', async () => {
    let body = null
    server.use(http.post(`${API}/api/portfolio/businesses/12/drafts/send/`, async ({ request }) => { body = await request.json(); return HttpResponse.json([]) }))
    renderPanel()
    await rowOf('Unsent skirt')
    fireEvent.click(screen.getByRole('button', { name: 'Send for owner confirmation' }))
    await waitFor(() => expect(body).toEqual({ draft_ids: [1] }))
  })

  it('withdraws a draft with DELETE', async () => {
    let hit = false
    server.use(http.delete(`${API}/api/portfolio/businesses/12/drafts/1/`, () => { hit = true; return HttpResponse.json({ id: 1 }) }))
    renderPanel()
    fireEvent.click(within(await rowOf('Unsent skirt')).getByRole('button', { name: 'Withdraw' }))
    await waitFor(() => expect(hit).toBe(true))
  })

  it('says when there are no drafts', async () => {
    renderPanel(SCOUT, [])
    expect(await screen.findByText(/No drafts yet/)).toBeInTheDocument()
  })
})
