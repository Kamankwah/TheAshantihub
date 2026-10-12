import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../../../mocks/server.js'
import DeliveriesReturnsPanel from '../DeliveriesReturnsPanel.jsx'

const API = 'http://localhost:8000'
const auth = (perms) => ({ user: { id: 2, role: 'operations' }, hasPermission: (c) => perms.includes(c) })
const data = (over = {}) => ({
  today: '2026-10-07', assigned_today: 1, assignments_total: 2,
  assignments: [
    { id: 1, order_id: 12, businesses: [{ id: 5, name: 'Suame Auto Parts' }], to: 'Bantama, Kumasi', rider: 'Yaw Rider', status: 'picked_up', status_label: 'Picked up', delivery_status: 'shipped', delivery_status_label: 'Shipped', last_update: '2026-10-07T10:15:00', last_update_label: 'Picked up' },
    { id: 2, order_id: 13, businesses: [{ id: 6, name: 'Adwoa Fabrics' }], to: null, rider: null, status: 'assigned', status_label: 'Assigned', delivery_status: 'processing', delivery_status_label: 'Processing', last_update: '2026-10-07T09:00:00', last_update_label: 'Assigned' },
  ],
  disputes: [{ id: 3, order_id: 12, businesses: [{ id: 5, name: 'Suame Auto Parts' }, { id: 6, name: 'Adwoa Fabrics' }], reason: 'Delivery Issue', status: 'open', status_label: 'Open', description: 'Never came', raised_by: 'Ama', handled_by: null, opened_at: '2026-10-06T08:00:00Z', open_seconds: 90000 }],
  dispute_total: 1, delivery_status_choices: [{ value: 'processing', label: 'Processing' }, { value: 'shipped', label: 'Shipped' }, { value: 'delivered', label: 'Delivered' }],
  ...over,
})
function renderPanel(perms = ['service_issues.view', 'orders.manage_delivery', 'fraud.flag']) {
  server.use(http.get(`${API}/api/operations/deliveries/`, () => HttpResponse.json(data())))
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}><DeliveriesReturnsPanel auth={auth(perms)} /></QueryClientProvider>)
}

describe('DeliveriesReturnsPanel', () => {
  it('shows the real assignments and disputes and says what arrives with the Delivery phase', async () => {
    renderPanel()
    const row = (await screen.findByText('#12')).closest('tr')
    expect(row).toHaveTextContent('Suame Auto Parts → Bantama, Kumasi')
    expect(row).toHaveTextContent('Yaw Rider')
    expect(row).toHaveTextContent('Picked up')
    expect(screen.getByText('#13').closest('tr')).toHaveTextContent('address not recorded')
    expect(screen.getByText('#13').closest('tr')).toHaveTextContent('Not assigned')
    expect(screen.getByText(/Rider offers, handover codes, rider locations and delivery returns arrive with the Delivery phase/)).toBeInTheDocument()
    expect(screen.getByText('Dispute #3').closest('tr')).toHaveTextContent('not picked up yet')
    expect(screen.queryByText(/Answer due/)).not.toBeInTheDocument()
  })

  it('changes a delivery status with the existing endpoint when the permission is held', async () => {
    let body
    server.use(http.patch(`${API}/api/orders/12/delivery-status/`, async ({ request }) => { body = await request.json(); return HttpResponse.json({ delivery_status: 'delivered' }) }))
    renderPanel()
    fireEvent.click(await screen.findByRole('button', { name: 'Change status of order #12' }))
    fireEvent.change(screen.getByLabelText('New status for order #12'), { target: { value: 'delivered' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText(/Order #12 is now delivered/)).toBeInTheDocument()
    expect(body).toEqual({ delivery_status: 'delivered' })
  })

  it('is read-only without orders.manage_delivery', async () => {
    renderPanel(['service_issues.view', 'fraud.flag'])
    await screen.findByText('#12')
    expect(screen.queryByRole('button', { name: /Change status/ })).not.toBeInTheDocument()
    expect(screen.queryByText('Update status')).not.toBeInTheDocument()
  })

  it('flags a dispute as fraud about the chosen business', async () => {
    let body
    server.use(http.post(`${API}/api/fraud/flags/`, async ({ request }) => { body = await request.json(); return HttpResponse.json({ id: 9 }, { status: 201 }) }))
    renderPanel()
    const row = (await screen.findByText('Dispute #3')).closest('tr')
    fireEvent.click(within(row).getByRole('button', { name: 'Flag as fraud' }))
    fireEvent.change(within(row).getByLabelText('Business'), { target: { value: '6' } })
    fireEvent.click(within(row).getByRole('button', { name: 'Raise fraud case' }))
    expect(await screen.findByText('Fraud case raised for dispute #3.')).toBeInTheDocument()
    expect(body).toMatchObject({ kind: 'other', business_owner: 6 })
  })
})
