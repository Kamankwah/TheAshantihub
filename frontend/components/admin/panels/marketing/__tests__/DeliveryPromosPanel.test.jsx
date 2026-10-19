import { fireEvent, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import DeliveryPromosPanel from '../DeliveryPromosPanel.jsx'
import { server } from '../../../../../mocks/server.js'
import { API, renderMk } from './mkTestUtils.jsx'

const BASE = { name: 'Free delivery weekend', business_id: 7, business: 'Kente House', starts_at: '2026-10-14T08:00:00Z', ends_at: '2026-10-16T08:00:00Z', all_items: true, listings: [], status: 'pending', effective_status: 'pending', live: false, source: 'staff', rejection_reason: '', covered_total: '0.00', covered_orders: 0 }
const OWN = { ...BASE, id: 1, funded_by: 'business', budget_cap: null, spent: null, awaiting_approval: false, approval_id: null }
const PLATFORM = { ...BASE, id: 2, name: 'AshantiHub weekend', funded_by: 'platform', budget_cap: '500.00', spent: '120.00', awaiting_approval: false, approval_id: 31, status: 'active', effective_status: 'active' }
const WAITING = { ...BASE, id: 3, name: 'Needs a decision', funded_by: 'platform', budget_cap: '300.00', spent: '0.00', awaiting_approval: true, approval_id: 40 }

const list = (results) => server.use(http.get(`${API}/api/marketing/delivery-promos/`, () => HttpResponse.json({ results })))

describe('staff DeliveryPromosPanel', () => {
  it('hides the create form without delivery_promo.fund', async () => {
    list([OWN])
    renderMk(DeliveryPromosPanel, { permissions: ['site_promo.manage'] })
    await screen.findByText('Free delivery weekend')
    expect(screen.queryByRole('form', { name: /AshantiHub-paid/i })).not.toBeInTheDocument()
  })

  it('lists funded_by, cap and spent', async () => {
    list([OWN, PLATFORM])
    renderMk(DeliveryPromosPanel, { permissions: [] })
    expect(await screen.findByText('Paid by AshantiHub')).toBeInTheDocument()
    expect(screen.getByText('Paid by the business')).toBeInTheDocument()
    expect(screen.getByText(/Spent GH₵ 120\.00 of GH₵ 500\.00/)).toBeInTheDocument()
  })

  it('a promo awaiting approval has no approve or reject buttons', async () => {
    list([WAITING])
    renderMk(DeliveryPromosPanel, { permissions: [] })
    expect(await screen.findByText(/Waiting for Operations or Super Admin/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Not approve' })).not.toBeInTheDocument()
  })

  function fill() {
    fireEvent.change(screen.getByLabelText('Find the business'), { target: { value: 'Kente' } })
  }
  async function fillAll() {
    fill()
    fireEvent.click(await screen.findByRole('button', { name: /Kente House/ }))
    fireEvent.change(screen.getByLabelText('Promo name'), { target: { value: 'Pay the fee' } })
    fireEvent.change(screen.getByLabelText('Starts'), { target: { value: '2026-10-20T08:00' } })
    fireEvent.change(screen.getByLabelText('Ends'), { target: { value: '2026-10-22T08:00' } })
    fireEvent.change(screen.getByLabelText('Budget cap (GH₵)'), { target: { value: '250' } })
  }
  const owners = http.get(`${API}/api/accounts/business-owners/`, () => HttpResponse.json({ results: [{ id: 7, full_name: 'Ama', business_name: 'Kente House' }] }))

  it('submits all_items true with the cap, says it was sent to Operations or Super Admin, and shows the pending promo after refetch', async () => {
    let sent = null
    let created = false
    server.use(owners,
      http.get(`${API}/api/marketing/delivery-promos/`, () => HttpResponse.json({ results: created ? [WAITING] : [] })),
      http.post(`${API}/api/marketing/delivery-promos/platform/`, async ({ request }) => { sent = await request.json(); created = true; return HttpResponse.json({ ...WAITING, approval: { id: 40, status: 'pending' } }, { status: 201 }) }))
    renderMk(DeliveryPromosPanel, { permissions: ['delivery_promo.fund'] })
    await fillAll()
    fireEvent.click(screen.getByRole('button', { name: 'Send for approval' }))
    expect(await screen.findByText('Sent for approval to Operations or a Super Admin.')).toBeInTheDocument()
    expect(sent).toMatchObject({ business_owner: 7, name: 'Pay the fee', all_items: true, budget_cap: '250' })
    expect(await screen.findByText('Needs a decision')).toBeInTheDocument()
  })

  it("shows the server's error for a blocked business", async () => {
    list([])
    server.use(owners, http.post(`${API}/api/marketing/delivery-promos/platform/`, () => HttpResponse.json({ detail: 'This business is blocked from promotions.' }, { status: 403 })))
    renderMk(DeliveryPromosPanel, { permissions: ['delivery_promo.fund'] })
    await fillAll()
    fireEvent.click(screen.getByRole('button', { name: 'Send for approval' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('This business is blocked from promotions.'))
  })
})
