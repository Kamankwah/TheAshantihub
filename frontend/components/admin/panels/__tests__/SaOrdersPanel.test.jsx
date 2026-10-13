import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../../../mocks/server.js'
import SaOrdersPanel from '../SaOrdersPanel.jsx'
import { API, page, param, renderPanel } from './saTestUtils.jsx'

const ROWS = [
  { id: 1, customer: 'Yaw Mensah', businesses: ['Akosua Ntoma Kente'], items: [{ name: 'Kente stole', quantity: 1 }], total: '450.00', status: 'paid', delivery_status: 'out_for_delivery', delivery_method: 'door_to_door', placed_at: '2026-10-07T10:00:00Z', open_case: false, rider: 'Kofi Appiah', rider_id: 5, assignment_status: 'picked_up', waiting_for_rider: false },
  { id: 2, customer: 'Efua Adjei', businesses: ['Nana\'s Chop Bar'], items: [{ name: 'Jollof', quantity: 2 }], total: '80.00', status: 'paid', delivery_status: 'processing', delivery_method: 'door_to_door', placed_at: '2026-10-07T11:00:00Z', open_case: true, rider: null, rider_id: null, assignment_status: null, waiting_for_rider: true },
]
const COUNTS = { orders_today: 2, items_value_today: '530.00', in_flight: 2, waiting_for_rider: 1, delivered_today: 0, with_open_case: 1, riders: [{ id: 5, name: 'Kofi Appiah' }] }

function setup() {
  const urls = []
  server.use(
    http.get(`${API}/api/marketplace/orders/`, ({ request }) => { urls.push(request.url); return HttpResponse.json(page(ROWS)) }),
    http.get(`${API}/api/marketplace/orders/counts/`, () => HttpResponse.json(COUNTS)),
    http.get(`${API}/api/marketplace/orders/1/`, () => HttpResponse.json({
      ...ROWS[0], delivery_address: 'Ahodwo', notes: 'Gate was locked', lines: [{ name: 'Kente stole', quantity: 1, line_total: '450.00', business: 'Akosua Ntoma Kente' }],
      steps: [{ at: '2026-10-07T10:00:00Z', text: 'Placed (paid)' }, { at: '2026-10-07T11:00:00Z', text: 'Picked up from the business' }],
    })),
  )
  return urls
}

describe('SaOrdersPanel', () => {
  it('has only the columns the records support: no delivery fee, rider pay or cash', async () => {
    setup()
    renderPanel(<SaOrdersPanel />)
    const table = await screen.findByRole('table', { name: 'Orders' })
    const headers = within(table).getAllByRole('columnheader').map((h) => h.textContent)
    expect(headers).toEqual(['Order', 'Items', 'Payment', 'Delivery', 'Rider', 'Placed', ''])
    expect(screen.getByText(/Delivery fees, rider pay and cash on delivery are not recorded on orders yet/)).toBeInTheDocument()
    expect(screen.getByText(/Payments are simulated/)).toBeInTheDocument()
    for (const missing of [/Cash with riders/, /Customer money held/, /Delivery fees today/]) expect(screen.queryByText(missing)).not.toBeInTheDocument()
  })

  it('shows rows, a waiting-for-rider mark and an open case', async () => {
    setup()
    renderPanel(<SaOrdersPanel />)
    const table = await screen.findByRole('table', { name: 'Orders' })
    const first = within(table).getByText('#1 · Akosua Ntoma Kente').closest('tr')
    expect(within(first).getByText('Kofi Appiah')).toBeInTheDocument()
    expect(within(first).getByText('On the way')).toBeInTheDocument()
    const second = within(table).getByText("#2 · Nana's Chop Bar").closest('tr')
    expect(within(second).getByText('Waiting for a rider')).toBeInTheDocument()
    expect(within(second).getByText('Open case')).toBeInTheDocument()
  })

  it('shows the real counts', async () => {
    setup()
    renderPanel(<SaOrdersPanel />)
    const strip = await screen.findByRole('group', { name: 'Orders summary' })
    await waitFor(() => expect(within(strip).getByText('GH₵ 530.00 in items')).toBeInTheDocument())
    expect(within(strip).getByText('1 waiting for a rider')).toBeInTheDocument()
  })

  it('sends the filters, including a date range', async () => {
    const urls = setup()
    renderPanel(<SaOrdersPanel />)
    fireEvent.change(await screen.findByLabelText('Delivery'), { target: { value: 'waiting_for_rider' } })
    await waitFor(() => expect(urls.some((u) => param(u, 'delivery') === 'waiting_for_rider')).toBe(true))
    await waitFor(() => expect(screen.getByLabelText('Rider')).toContainElement(screen.getByRole('option', { name: 'Kofi Appiah' })))
    fireEvent.change(screen.getByLabelText('Rider'), { target: { value: '5' } })
    await waitFor(() => expect(urls.some((u) => param(u, 'rider') === '5')).toBe(true))
    fireEvent.change(screen.getByLabelText('Day'), { target: { value: 'range' } })
    fireEvent.change(await screen.findByLabelText('From'), { target: { value: '2026-10-01' } })
    await waitFor(() => expect(urls.some((u) => param(u, 'day') === 'range' && param(u, 'from') === '2026-10-01')).toBe(true))
  })

  it('opens an order to its recorded steps', async () => {
    setup()
    renderPanel(<SaOrdersPanel />)
    fireEvent.click(await screen.findByRole('button', { name: 'Open order 1' }))
    const side = await screen.findByRole('region', { name: 'Order 1' })
    expect(await within(side).findByText(/Picked up from the business/)).toBeInTheDocument()
    expect(within(side).getByText("Courier's note: Gate was locked")).toBeInTheDocument()
  })
})
