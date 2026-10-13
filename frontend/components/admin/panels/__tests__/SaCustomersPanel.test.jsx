import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../../../mocks/server.js'
import SaCustomersPanel from '../SaCustomersPanel.jsx'
import { API, SA, page, param, renderPanel } from './saTestUtils.jsx'

const ROWS = [
  { id: 1, name: 'Ama Buyer', phone: '024 *** 4567', joined_at: '2026-08-01T00:00:00Z', orders: 2, spend: '50.00', disputes: 0, open_disputes: 0, last_order_at: '2026-10-05T00:00:00Z', is_suspended: false, suspension_reason: '' },
  { id: 2, name: 'Kwasi Owusu', phone: '020 *** 1111', joined_at: '2026-09-01T00:00:00Z', orders: 1, spend: '15.00', disputes: 1, open_disputes: 1, last_order_at: null, is_suspended: true, suspension_reason: 'Refund abuse' },
]
const COUNTS = { total: 2, joined_this_month: 1, ordered_90_days: 1, with_open_case: 1, suspended: 1 }

function setup() {
  const seen = { urls: [], reveals: [], suspends: [] }
  server.use(
    http.get(`${API}/api/marketplace/customers/`, ({ request }) => { seen.urls.push(request.url); return HttpResponse.json(page(ROWS)) }),
    http.get(`${API}/api/marketplace/customers/counts/`, () => HttpResponse.json(COUNTS)),
    http.get(`${API}/api/marketplace/customers/1/`, () => HttpResponse.json({ ...ROWS[0], email: 'ama@example.com', orders_recent: [{ id: 7, total: '30.00', status: 'paid', delivery_status: 'delivered', placed_at: '2026-10-05T00:00:00Z', businesses: ['Akosua Ntoma Kente'] }], disputes_recent: [] })),
    http.post(`${API}/api/marketplace/customers/:id/reveal-phone/`, ({ params }) => { seen.reveals.push(params.id); return HttpResponse.json({ phone: '+233241234567' }) }),
    http.post(`${API}/api/accounts/customers/:id/suspend/`, async ({ request, params }) => { seen.suspends.push({ id: params.id, ...(await request.json()) }); return HttpResponse.json({ id: 1 }) }),
  )
  return seen
}

describe('SaCustomersPanel', () => {
  it('has no marketing-SMS column, tile or filter, and says why', async () => {
    setup()
    renderPanel(<SaCustomersPanel auth={SA} />)
    const table = await screen.findByRole('table', { name: 'Customers' })
    expect(within(table).queryByText(/Marketing SMS/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Opted in/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/Marketing SMS/i)).not.toBeInTheDocument()
    expect(screen.getByText(/Whether a customer agreed to marketing texts is not recorded yet/)).toBeInTheDocument()
  })

  it('shows masked phones, counts, status and the reason for a suspension', async () => {
    setup()
    renderPanel(<SaCustomersPanel auth={SA} />)
    const table = await screen.findByRole('table', { name: 'Customers' })
    const ama = within(table).getByText('Ama Buyer').closest('tr')
    expect(within(ama).getByText('024 *** 4567')).toBeInTheDocument()
    expect(within(ama).getByText('GH₵ 50.00')).toBeInTheDocument()
    const kwasi = within(table).getByText('Kwasi Owusu').closest('tr')
    expect(within(kwasi).getByText('1 open')).toBeInTheDocument()
    expect(within(kwasi).getByText('Refund abuse')).toBeInTheDocument()
    expect(within(kwasi).getByText('No orders yet')).toBeInTheDocument()
    const strip = screen.getByRole('group', { name: 'Customers summary' })
    await waitFor(() => expect(within(strip).getByText('Ordered in 90 days')).toBeInTheDocument())
    expect(within(strip).getByText('50% of customers')).toBeInTheDocument()
  })

  it('shows a full phone only after the explicit, recorded request', async () => {
    const seen = setup()
    renderPanel(<SaCustomersPanel auth={SA} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Show full phone of Ama Buyer' }))
    expect(await screen.findByText('+233241234567')).toBeInTheDocument()
    expect(seen.reveals).toEqual(['1'])
  })

  it('passes the filters and the search to the server', async () => {
    const seen = setup()
    renderPanel(<SaCustomersPanel auth={SA} />)
    fireEvent.change(await screen.findByLabelText('Open case'), { target: { value: 'open' } })
    await waitFor(() => expect(seen.urls.some((u) => param(u, 'case') === 'open')).toBe(true))
    fireEvent.change(screen.getByLabelText('Name, phone or order number'), { target: { value: '#17' } })
    await waitFor(() => expect(seen.urls.some((u) => param(u, 'q') === '#17')).toBe(true))
  })

  it('suspends with a reason and lifts without one', async () => {
    const seen = setup()
    server.use(http.post(`${API}/api/accounts/customers/2/unsuspend/`, () => { seen.suspends.push({ id: '2', lifted: true }); return HttpResponse.json({ id: 2 }) }))
    renderPanel(<SaCustomersPanel auth={SA} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Suspend Ama Buyer' }))
    const form = screen.getByRole('form', { name: 'Suspend Ama Buyer' })
    expect(within(form).getByText(/cannot buy, book or review/)).toBeInTheDocument()
    fireEvent.change(within(form).getByLabelText(/Reason/), { target: { value: 'Abuse' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Suspend' }))
    await waitFor(() => expect(seen.suspends).toContainEqual({ id: '1', reason: 'Abuse' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Lift suspension of Kwasi Owusu' }))
    fireEvent.click(within(screen.getByRole('form', { name: 'Lift the suspension of Kwasi Owusu' })).getByRole('button', { name: 'Lift suspension' }))
    await waitFor(() => expect(seen.suspends).toContainEqual({ id: '2', lifted: true }))
  })

  it('opens a customer to see orders and disputes', async () => {
    setup()
    renderPanel(<SaCustomersPanel auth={SA} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Open Ama Buyer' }))
    const side = await screen.findByRole('region', { name: 'Customer' })
    expect(await within(side).findByText(/#7 · Akosua Ntoma Kente · GH₵ 30.00/)).toBeInTheDocument()
    expect(within(side).getByText('None.')).toBeInTheDocument()
  })

  it('hides export and suspend from someone without users.manage', async () => {
    setup()
    renderPanel(<SaCustomersPanel auth={{ ...SA, hasPermission: (c) => c === 'users.view' }} />)
    await screen.findByRole('table', { name: 'Customers' })
    expect(screen.queryByRole('button', { name: /Export/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Suspend Ama Buyer' })).not.toBeInTheDocument()
  })
})
