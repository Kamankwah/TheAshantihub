import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../../../mocks/server.js'
import SaListingsPanel from '../SaListingsPanel.jsx'
import { API, SA, page, param, renderPanel } from './saTestUtils.jsx'

const base = { business_id: 1, business_name: 'Akosua Ntoma Kente', type: 'product', category: 'Fashion', price_amount: '450.00', price_unit: null, created_at: '2026-10-01T00:00:00Z', reviewed_by: null, reviewed_at: null, rejection_reason: null, added_by: null }
const ROWS = [
  { ...base, id: 1, name: 'Handwoven kente stole', status: 'published', state: 'live', state_note: '' },
  { ...base, id: 2, name: 'Graduation stole', status: 'pending_review', state: 'waiting', state_note: 'Waiting for a decision', added_by: 'Efua Mensah' },
  { ...base, id: 3, name: 'Kente cloth', status: 'published', state: 'hidden', state_note: 'Business suspended' },
  { ...base, id: 4, name: 'Old stole', status: 'rejected', state: 'rejected', state_note: 'Blurry photo', reviewed_by: 'Ama Boateng', reviewed_at: '2026-10-02T00:00:00Z' },
]
const COUNTS = { live: 1, waiting: 1, oldest_waiting_at: '2026-10-01T00:00:00Z', hidden_unpaid: null, hidden_unpaid_businesses: null, hidden_suspended: 1, hidden_suspended_businesses: 1, rejected_this_month: 1, pause_enabled: false }

function setup(counts = COUNTS) {
  const seen = { urls: [], rejects: [], approvals: [] }
  server.use(
    http.get(`${API}/api/marketplace/listings/`, ({ request }) => { seen.urls.push(request.url); return HttpResponse.json(page(ROWS)) }),
    http.get(`${API}/api/marketplace/listings/counts/`, () => HttpResponse.json(counts)),
    http.get(`${API}/api/listings/categories/`, () => HttpResponse.json([{ id: 5, label: 'Fashion' }])),
    http.get(`${API}/api/marketplace/listings/1/history/`, () => HttpResponse.json({ id: 1, name: 'Handwoven kente stole', business_name: 'Akosua Ntoma Kente', events: [{ at: '2026-10-02T00:00:00Z', text: 'Approved', who: 'Ama Boateng' }, { at: '2026-10-01T00:00:00Z', text: 'Added by the owner', who: 'Akosua' }] })),
    http.post(`${API}/api/listings/moderation/:id/approve/`, ({ params }) => { seen.approvals.push(params.id); return HttpResponse.json({ id: Number(params.id), status: 'published' }) }),
    http.post(`${API}/api/listings/moderation/:id/reject/`, async ({ request, params }) => { seen.rejects.push({ id: params.id, ...(await request.json()) }); return HttpResponse.json({ id: 1 }) }),
  )
  return seen
}

describe('SaListingsPanel', () => {
  it('shows every state, why a listing is hidden, and who moderated', async () => {
    setup()
    renderPanel(<SaListingsPanel auth={SA} />)
    const table = await screen.findByRole('table', { name: 'Listings' })
    expect(within(within(table).getByText('Kente cloth').closest('tr')).getByText('Business suspended')).toBeInTheDocument()
    const old = within(table).getByText('Old stole').closest('tr')
    expect(within(old).getByText('Blurry photo')).toBeInTheDocument()
    expect(within(old).getByText(/Ama Boateng/)).toBeInTheDocument()
    expect(within(within(table).getByText('Graduation stole').closest('tr')).getByText(/Efua Mensah \(scout, for the owner\)/)).toBeInTheDocument()
  })

  it('lets a Super Admin approve a listing that is waiting, and only those', async () => {
    const seen = setup()
    renderPanel(<SaListingsPanel auth={SA} />)
    const table = await screen.findByRole('table', { name: 'Listings' })
    expect(within(table).queryByRole('button', { name: 'Approve Handwoven kente stole' })).not.toBeInTheDocument()
    expect(within(table).queryByRole('button', { name: 'Approve Old stole' })).not.toBeInTheDocument()
    fireEvent.click(within(table).getByRole('button', { name: 'Approve Graduation stole' }))
    await waitFor(() => expect(seen.approvals).toEqual(['2']))
    expect(await screen.findByText('Published “Graduation stole”.')).toBeInTheDocument()
  })

  it('shows why an approval was refused', async () => {
    setup()
    server.use(http.post(`${API}/api/listings/moderation/:id/approve/`, () => HttpResponse.json({ detail: 'Cannot publish a listing whose owner is not KYC-verified.' }, { status: 400 })))
    renderPanel(<SaListingsPanel auth={SA} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Approve Graduation stole' }))
    expect(await screen.findByText(/not KYC-verified/)).toBeInTheDocument()
  })

  it('shows the unpaid tile only while the pause is on', async () => {
    setup()
    renderPanel(<SaListingsPanel auth={SA} />)
    const strip = await screen.findByRole('group', { name: 'Listings summary' })
    await waitFor(() => expect(within(strip).getByText('Hidden · suspended')).toBeInTheDocument())
    expect(within(strip).queryByText('Hidden · unpaid')).not.toBeInTheDocument()
  })

  it('shows the unpaid tile when the pause is on', async () => {
    setup({ ...COUNTS, pause_enabled: true, hidden_unpaid: 41, hidden_unpaid_businesses: 9 })
    renderPanel(<SaListingsPanel auth={SA} />)
    expect(await screen.findByText('Hidden · unpaid')).toBeInTheDocument()
    expect(screen.getByText('9 businesses paused')).toBeInTheDocument()
  })

  it('sends the filters', async () => {
    const seen = setup()
    renderPanel(<SaListingsPanel auth={SA} />)
    fireEvent.change(await screen.findByLabelText('Status'), { target: { value: 'hidden' } })
    await waitFor(() => expect(seen.urls.some((u) => param(u, 'status') === 'hidden')).toBe(true))
    fireEvent.change(screen.getByLabelText('Added by'), { target: { value: 'scout' } })
    await waitFor(() => expect(seen.urls.some((u) => param(u, 'added_by') === 'scout')).toBe(true))
  })

  it('opens the history of a listing', async () => {
    setup()
    renderPanel(<SaListingsPanel auth={SA} />)
    fireEvent.click(await screen.findByRole('button', { name: 'History of Handwoven kente stole' }))
    const history = await screen.findByRole('region', { name: 'History of Handwoven kente stole' })
    expect(await within(history).findByText(/Approved · Ama Boateng/)).toBeInTheDocument()
  })

  it('takes a published listing down as a rejection with a reason, and says so', async () => {
    const seen = setup()
    renderPanel(<SaListingsPanel auth={SA} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Take down Handwoven kente stole' }))
    const form = screen.getByRole('form', { name: 'Take down Handwoven kente stole' })
    expect(within(form).getByText(/recorded as rejected/)).toBeInTheDocument()
    const submit = within(form).getByRole('button', { name: 'Take down' })
    expect(submit).toBeDisabled()
    fireEvent.change(within(form).getByLabelText(/Reason/), { target: { value: 'Counterfeit' } })
    fireEvent.click(submit)
    await waitFor(() => expect(seen.rejects).toEqual([{ id: '1', reason: 'Counterfeit' }]))
  })

  it('offers no take-down for a listing that is not published', async () => {
    setup()
    renderPanel(<SaListingsPanel auth={SA} />)
    await screen.findByRole('table', { name: 'Listings' })
    expect(screen.queryByRole('button', { name: 'Take down Old stole' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Take down Graduation stole' })).not.toBeInTheDocument()
  })
})
