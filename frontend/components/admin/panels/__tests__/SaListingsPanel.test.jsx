import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../../../mocks/server.js'
import SaListingsPanel from '../SaListingsPanel.jsx'
import { API, SA, page, param, renderPanel } from './saTestUtils.jsx'

const base = { business_id: 1, business_name: 'Akosua Ntoma Kente', type: 'product', category: 'Fashion', price_amount: '450.00', price_unit: null, created_at: '2026-10-01T00:00:00Z', reviewed_by: null, reviewed_at: null, rejection_reason: null, added_by: null }
const ROWS = [
  { ...base, id: 1, name: 'Handwoven kente stole', status: 'published', state: 'live', state_note: '', paid_count: 12, refunded_count: 2 },
  { ...base, id: 2, name: 'Graduation stole', status: 'pending_review', state: 'waiting', state_note: 'Waiting for a decision', added_by: 'Efua Mensah', added_by_role: 'Scout', paid_count: 0, refunded_count: 0 },
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
    http.get(`${API}/api/listings/moderation/2/`, () => HttpResponse.json({
      id: 2, name: 'Graduation stole', description: 'Hand-woven for graduates.', price_amount: '450.00', price_unit: 'per item', tag: 'New',
      contact_phone: '+233200000101', category: { id: 5, label: 'Fashion', kind: 'product' }, zone: { id: 1, name: 'Manhyia' },
      main_photo: null, photos: [{ id: 9, image: 'http://localhost:8000/media/p1.jpg', order: 0 }], specs: [{ label: 'Material', value: 'Silk' }],
      brand: 'Bonwire', condition: 'new', dimensions: '2m', weight: '300g', stock_quantity: 12,
      has_warranty: true, warranty_details: '6 month seam warranty', has_expiry: false, expiry_date: null, return_policy: 'Returns within 7 days',
      service_duration: '', whats_included: '', requirements: '', revisions: '', delivery_time: '', open_fraud_cases: 0,
    })),
    http.post(`${API}/api/listings/moderation/:id/approve/`, ({ params }) => { seen.approvals.push(params.id); return HttpResponse.json({ id: Number(params.id), status: 'published' }) }),
    http.post(`${API}/api/listings/moderation/:id/reject/`, async ({ request, params }) => { seen.rejects.push({ id: params.id, ...(await request.json()) }); return HttpResponse.json({ id: 1 }) }),
  )
  return seen
}

describe('SaListingsPanel paid and refunded', () => {
  it('shows each row\'s paid and refunded numbers, a real 0 as 0, and what each counts', async () => {
    setup()
    renderPanel(<SaListingsPanel auth={SA} />)
    const table = await screen.findByRole('table', { name: 'Listings' })
    const heads = within(table).getAllByRole('columnheader').map((th) => th.textContent)
    const paidAt = heads.findIndex((t) => t.startsWith('Paid'))
    expect(paidAt).toBeGreaterThan(-1)
    expect(heads[paidAt + 1].startsWith('Refunded')).toBe(true)
    expect(within(table).getByRole('columnheader', { name: /^Paid/ })).toHaveAttribute('title', expect.stringMatching(/paid/i))
    expect(within(table).getByRole('columnheader', { name: /^Refunded/ })).toHaveAttribute('title', expect.stringMatching(/refund/i))
    const cells = (name) => within(within(table).getByText(name).closest('tr')).getAllByRole('cell').map((td) => td.textContent)
    expect(cells('Handwoven kente stole').slice(paidAt, paidAt + 2)).toEqual(['12', '2'])
    expect(cells('Graduation stole').slice(paidAt, paidAt + 2)).toEqual(['0', '0'])
  })

  it('shows a skeleton, never a dash, when a row has no count yet', async () => {
    setup()
    renderPanel(<SaListingsPanel auth={SA} />)
    const table = await screen.findByRole('table', { name: 'Listings' })
    const row = within(table).getByText('Old stole').closest('tr')
    expect(within(row).getAllByRole('status', { name: 'Loading' }).length).toBe(2)
    expect(row.textContent).not.toMatch(/—\s*—/)
  })
})

describe('SaListingsPanel', () => {
  it('shows every state, why a listing is hidden, and who moderated', async () => {
    setup()
    renderPanel(<SaListingsPanel auth={SA} />)
    const table = await screen.findByRole('table', { name: 'Listings' })
    expect(within(within(table).getByText('Kente cloth').closest('tr')).getByText('Business suspended')).toBeInTheDocument()
    const old = within(table).getByText('Old stole').closest('tr')
    expect(within(old).getByText('Blurry photo')).toBeInTheDocument()
    expect(within(old).getByText(/Ama Boateng/)).toBeInTheDocument()
    expect(within(within(table).getByText('Graduation stole').closest('tr')).getByText(/Efua Mensah \(Scout, for the owner\)/)).toBeInTheDocument()
  })

  it('names the lister by their real role, and does not promise a 7-day owner undo on a listing made for an owner', async () => {
    setup()
    server.use(http.get(`${API}/api/marketplace/listings/`, () => HttpResponse.json({
      count: 1, next: null, previous: null,
      results: [{ ...ROWS[1], id: 9, name: 'Ops-made stole', added_by: 'Ama Boateng', added_by_role: 'Operations' }],
    })))
    renderPanel(<SaListingsPanel auth={SA} />)
    const table = await screen.findByRole('table', { name: 'Listings' })
    const row = within(table).getByText('Ops-made stole').closest('tr')
    expect(within(row).getByText(/Ama Boateng \(Operations, for the owner\)/)).toBeInTheDocument()
    expect(within(row).queryByText(/scout, for the owner/i)).toBeNull()
    const rules = screen.getByRole('region', { name: 'How moderation works' })
    expect(rules).toHaveTextContent(/confirms it by text first/i)
    expect(rules.textContent).not.toMatch(/every change a scout makes and can undo/)
  })

  it('shows everything the owner submitted before a Super Admin approves, and only for waiting listings', async () => {
    const seen = setup()
    renderPanel(<SaListingsPanel auth={SA} />)
    const table = await screen.findByRole('table', { name: 'Listings' })
    expect(within(table).queryByRole('button', { name: /View or approve Handwoven kente stole/ })).not.toBeInTheDocument()
    expect(within(table).queryByRole('button', { name: /View or approve Old stole/ })).not.toBeInTheDocument()
    fireEvent.click(within(table).getByRole('button', { name: 'View or approve Graduation stole' }))
    const sheet = await screen.findByRole('region', { name: 'Review Graduation stole' })
    expect(await within(sheet).findByText('Hand-woven for graduates.')).toBeInTheDocument()
    expect(within(sheet).getByRole('img', { name: 'Graduation stole picture 1' })).toHaveAttribute('src', 'http://localhost:8000/media/p1.jpg')
    for (const text of ['Bonwire', 'Returns within 7 days', '6 month seam warranty', 'Silk', '+233200000101', 'Manhyia']) expect(within(sheet).getByText(text)).toBeInTheDocument()
    expect(seen.approvals).toEqual([])
    fireEvent.click(within(sheet).getByRole('button', { name: 'Approve Graduation stole' }))
    await waitFor(() => expect(seen.approvals).toEqual(['2']))
    expect(await screen.findByText('Published “Graduation stole”.')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Review Graduation stole' })).not.toBeInTheDocument()
  })

  it('says so when no picture was uploaded', async () => {
    setup()
    server.use(http.get(`${API}/api/listings/moderation/2/`, () => HttpResponse.json({ id: 2, name: 'Graduation stole', description: 'D', price_amount: '1.00', category: { label: 'Fashion', kind: 'product' }, zone: { name: 'Manhyia' }, main_photo: null, photos: [], specs: [] })))
    renderPanel(<SaListingsPanel auth={SA} />)
    fireEvent.click(await screen.findByRole('button', { name: 'View or approve Graduation stole' }))
    expect(await screen.findByText('No picture was uploaded.')).toBeInTheDocument()
  })

  it('shows why an approval was refused', async () => {
    setup()
    server.use(http.post(`${API}/api/listings/moderation/:id/approve/`, () => HttpResponse.json({ detail: 'Cannot publish a listing whose owner is not KYC-verified.' }, { status: 400 })))
    renderPanel(<SaListingsPanel auth={SA} />)
    fireEvent.click(await screen.findByRole('button', { name: 'View or approve Graduation stole' }))
    const approveBtn = await screen.findByRole('button', { name: 'Approve Graduation stole' })
    await waitFor(() => expect(approveBtn).toBeEnabled())
    fireEvent.click(approveBtn)
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
  it('lets a deals.manage holder flag a product as sponsored, and offers nothing for services or without the permission', async () => {
    const seen = []
    setup()
    server.use(
      http.get(`${API}/api/marketplace/listings/`, () => HttpResponse.json(page([
        { ...base, id: 1, name: 'Handwoven kente stole', status: 'published', state: 'live', state_note: '', sponsored: false },
        { ...base, id: 6, name: 'Hair braiding', type: 'service', status: 'published', state: 'live', state_note: '', sponsored: false },
        { ...base, id: 7, name: 'Sponsored bag', status: 'published', state: 'live', state_note: '', sponsored: true },
      ]))),
      http.post(`${API}/api/listings/:id/sponsored/`, async ({ request, params }) => { seen.push({ id: params.id, ...(await request.json()) }); return HttpResponse.json({ id: 1, sponsored: true }) }),
    )
    const { unmount } = renderPanel(<SaListingsPanel auth={SA} />)
    const table = await screen.findByRole('table', { name: 'Listings' })
    fireEvent.click(within(table).getByRole('button', { name: 'Mark Handwoven kente stole as sponsored' }))
    await waitFor(() => expect(seen).toEqual([{ id: '1', sponsored: true }]))
    expect(within(table).getByRole('button', { name: 'Remove sponsored from Sponsored bag' })).toBeInTheDocument()
    expect(within(table).queryByRole('button', { name: /Hair braiding as sponsored/ })).toBeNull()
    unmount()
    renderPanel(<SaListingsPanel auth={{ ...SA, hasPermission: (c) => c !== 'deals.manage' }} />)
    await screen.findByRole('table', { name: 'Listings' })
    expect(screen.queryByRole('button', { name: /as sponsored/ })).toBeNull()
  })
})
