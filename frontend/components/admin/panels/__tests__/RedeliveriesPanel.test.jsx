import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../../../mocks/server.js'
import RedeliveriesPanel from '../RedeliveriesPanel.jsx'

// Re-deliveries for the Super Admin and the Pickup Desk (wallet 5F Task 9). The list answers whether the order
// qualifies, the fee in force and the reason it does not; the panel never shows a customer phone, email or address.
const API = 'http://localhost:8000'
const wrap = (ui) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>)
const qualifies = { results: [], redeliverable: true, redelivery_fee: '15.00', not_redeliverable_reason: null }
const row = (over = {}) => ({
  id: 5, order: 41, attempt: 1, status: 'awaiting_payment', status_label: 'Waiting for the customer to pay', fee: '15.00', fee_pesewas: 1500,
  reason: 'Customer asked at the desk', requested_by: 'Esi Mensah', rider: null, paid_through: null, ...over,
})

function mount(body, { status = 200 } = {}) {
  const seen = { urls: [], posts: [] }
  server.use(
    http.get(`${API}/api/delivery/redeliveries/`, ({ request }) => { seen.urls.push(request.url); return HttpResponse.json(body, { status }) }),
    http.post(`${API}/api/delivery/redeliveries/`, async ({ request }) => { seen.posts.push(await request.json()); return HttpResponse.json(row(), { status: 201 }) }),
    http.post(`${API}/api/delivery/redeliveries/:id/cancel/`, () => { seen.cancelled = true; return HttpResponse.json(row({ status: 'cancelled' })) }),
  )
  wrap(<RedeliveriesPanel />)
  return seen
}
const find = (n) => { fireEvent.change(screen.getByLabelText('Order number'), { target: { value: n } }); fireEvent.click(screen.getByRole('button', { name: 'Find' })) }

describe('RedeliveriesPanel', () => {
  it('finds an order and shows the fee it would carry', async () => {
    const seen = mount(qualifies)
    expect(screen.getByRole('heading', { name: 'Re-deliveries' })).toBeInTheDocument()
    expect(screen.getByText(/The customer pays the re-delivery fee first\. Dispatch gives the second trip to one of AshantiHub's own riders/)).toBeInTheDocument()
    find('#41')
    expect(await screen.findByText('Order #41')).toBeInTheDocument()
    expect(seen.urls[0]).toContain('order=41')
    expect(screen.getByText('GH₵ 15.00')).toBeInTheDocument()
  })

  it('asks for a second trip with a reason', async () => {
    const seen = mount(qualifies)
    find('41')
    const section = await screen.findByRole('region', { name: "Re-deliver at the customer's request" })
    const ask = within(section).getByRole('button', { name: /Ask the customer to pay and deliver again/ })
    expect(ask).toBeDisabled()
    fireEvent.change(within(section).getByLabelText(/Reason/), { target: { value: 'Customer asked at the desk' } })
    fireEvent.click(ask)
    await waitFor(() => expect(seen.posts).toEqual([{ order: 41, reason: 'Customer asked at the desk' }]))
  })

  it('shows why not when the order does not qualify', async () => {
    mount({ results: [], redeliverable: false, redelivery_fee: null, not_redeliverable_reason: 'This order cannot be delivered again at the customer\'s request: nothing.' })
    find('41')
    expect(await screen.findByText(/This order cannot be delivered again at the customer's request: nothing\./)).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: "Re-deliver at the customer's request" })).not.toBeInTheDocument()
  })

  it('an unknown order says so', async () => {
    mount({ detail: 'No order with that number.' }, { status: 404 })
    find('999')
    expect(await screen.findByRole('alert')).toHaveTextContent('No order with that number.')
  })

  it('an open request shows its state and can be cancelled while waiting for payment', async () => {
    const seen = mount({ results: [row()], redeliverable: false, redelivery_fee: null, not_redeliverable_reason: 'A re-delivery is already open for this order.' })
    find('41')
    expect(await screen.findByText('Waiting for the customer to pay GH₵ 15.00.')).toBeInTheDocument()
    expect(screen.queryByText('A re-delivery is already open for this order.')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel the re-delivery' }))
    await waitFor(() => expect(seen.cancelled).toBe(true))
  })

  it('lists earlier attempts with how the rider is paid', async () => {
    mount({
      results: [
        row({ id: 7, attempt: 3, status: 'awaiting_payment' }),
        row({ id: 6, attempt: 2, status: 'completed', status_label: 'Done', rider: 'Ama Boateng', paid_through: 'payroll' }),
        row({ id: 5, attempt: 1, status: 'completed', status_label: 'Done', rider: 'Swift Rider', paid_through: 'wallet' }),
        row({ id: 4, attempt: 0, status: 'cancelled', status_label: 'Cancelled', paid_through: null }),
      ], redeliverable: false, redelivery_fee: null, not_redeliverable_reason: 'A re-delivery is already open for this order.',
    })
    find('41')
    const earlier = await screen.findByRole('region', { name: 'Earlier attempts' })
    expect(within(earlier).getByText('Owed to the rider through payroll')).toBeInTheDocument()
    expect(within(earlier).getByText("Paid to the rider's AshantiHub wallet")).toBeInTheDocument()
    expect(within(earlier).getAllByText(/Owed to the rider|Paid to the rider/)).toHaveLength(2)
    expect(within(earlier).getByText(/Ama Boateng/)).toBeInTheDocument()
    expect(within(earlier).getAllByText(/Asked for by Esi Mensah/)).toHaveLength(3)
    expect(within(earlier).queryByText(/Attempt 3/)).not.toBeInTheDocument()   // the open request is shown above, not here
  })

  it('shows no customer phone, email or address', async () => {
    mount({ ...qualifies, results: [row({ status: 'completed', paid_through: 'wallet', phone: '+233244000001', email: 'a@b.com', delivery_address: '12 Kejetia Road' })] })
    find('41')
    await screen.findByText('Order #41')
    const text = document.body.textContent
    expect(text).not.toMatch(/\+233|@|Kejetia/)
  })
})
