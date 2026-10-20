import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../../../mocks/server.js'
import SupportOrderStatusPanel, { customerMessage } from '../SupportOrderStatusPanel.jsx'

const API = 'http://localhost:8000'
const row = { id: 1, customer: 'Yaw Mensah', customer_phone: '024 *** 0123', businesses: ['Akosua Ntoma Kente'], total: '420.00', status: 'paid', delivery_status: 'processing', delivery_method: 'door_to_door', placed_at: '2026-09-19T10:00:00Z' }
const detail = (over = {}) => ({
  ...row, customer_id: 3, customer_email: 'ya•••@example.com', delivery_address: 'Ahodwo, Kumasi', delivery_phone: '024 *** 0123', rider: null,
  lines: [{ name: 'Kente stole', quantity: 1, line_total: '420.00', business: 'Akosua Ntoma Kente' }],
  timeline: [{ key: 'placed', at: '2026-09-19T10:00:00Z', label: 'Placed', detail: 'Payment paid' }],
  actions: ['running_late', 'cancelled_by_customer'], payments: { provider: 'simulated', text: 'Payments are simulated until Hubtel is connected, so no money moves.' },
  delivery_note: 'Arrives with Delivery: arrival and wait stamps, handover codes, the rider\'s last location and \'can\'t deliver\' outcomes are not recorded yet.', ...over,
})

function setup(over = {}) {
  const seen = { posts: [], urls: [] }
  server.use(
    http.get(`${API}/api/orders/support/`, ({ request }) => { seen.urls.push(request.url); return HttpResponse.json({ results: [row], recent: [] }) }),
    http.get(`${API}/api/orders/support/:id/`, () => HttpResponse.json(detail(over))),
    http.post(`${API}/api/orders/:id/support-status/`, async ({ request }) => { seen.posts.push(await request.json()); return HttpResponse.json({ id: 1 }) }),
  )
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={queryClient}><SupportOrderStatusPanel /></QueryClientProvider>)
  return seen
}
const open = async () => { fireEvent.click(await screen.findByRole('listitem')); return screen.findByRole('region', { name: 'Update the status' }) }

describe('SupportOrderStatusPanel', () => {
  it('searches and shows masked phones, the timeline and an honest Delivery note', async () => {
    const seen = setup()
    fireEvent.change(screen.getByLabelText('Find an order'), { target: { value: 'yaw' } })
    fireEvent.click(screen.getByRole('button', { name: 'Find' }))
    await waitFor(() => expect(seen.urls.some((u) => new URL(u).searchParams.get('q') === 'yaw')).toBe(true))
    expect(await screen.findByText(/024 \*\*\* 0123/)).toBeInTheDocument()
    await open()
    expect(screen.getByRole('list', { name: 'Timeline' })).toHaveTextContent('Placed')
    expect(screen.getByText(/Arrives with Delivery/)).toBeInTheDocument()
    expect(screen.getByText(/Payments are simulated until Hubtel is connected/)).toBeInTheDocument()
  })

  it('only offers running late and cancelled, never Delivered', async () => {
    setup()
    const form = await open()
    const options = within(form).getAllByRole('option').map((o) => o.textContent)
    expect(options).toEqual(['Running late', 'Cancelled by customer'])
    expect(screen.queryByText('Delivered', { selector: 'option' })).not.toBeInTheDocument()
    expect(within(form).getByText(/cannot mark an order Delivered/)).toBeInTheDocument()
  })

  it('needs a reason and a new time, then posts running late', async () => {
    const seen = setup()
    const form = await open()
    const save = within(form).getByRole('button', { name: 'Save and notify' })
    expect(save).toBeDisabled()
    fireEvent.change(within(form).getByLabelText('New expected time'), { target: { value: 'about 12:15' } })
    fireEvent.change(within(form).getByLabelText(/Reason/), { target: { value: 'Rider stuck in traffic' } })
    expect(within(form).getByText(customerMessage('running_late', 1, 'about 12:15'), { exact: false })).toBeInTheDocument()
    fireEvent.click(save)
    await waitFor(() => expect(seen.posts).toEqual([{ status: 'running_late', reason: 'Rider stuck in traffic', expected_time: 'about 12:15' }]))
  })

  it('confirms before cancelling and says it is not a refund', async () => {
    const seen = setup()
    const form = await open()
    fireEvent.change(within(form).getByLabelText('New status'), { target: { value: 'cancelled_by_customer' } })
    expect(within(form).getByText(/does not refund anything/)).toBeInTheDocument()
    fireEvent.change(within(form).getByLabelText(/Reason/), { target: { value: 'Changed their mind' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Cancel the order…' }))
    expect(seen.posts).toEqual([])
    fireEvent.click(within(form).getByRole('button', { name: 'Confirm cancel and notify' }))
    await waitFor(() => expect(seen.posts).toEqual([{ status: 'cancelled_by_customer', reason: 'Changed their mind', expected_time: '' }]))
  })

  it('shows no update form when the server allows no action', async () => {
    setup({ actions: [], delivery_status: 'delivered' })
    fireEvent.click(await screen.findByRole('listitem'))
    expect(await screen.findByText(/No Support change is available/)).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Update the status' })).not.toBeInTheDocument()
  })
})

describe('SupportOrderStatusPanel re-delivery (Plan 7F-E Task 7)', () => {
  const auth = (perms) => ({ hasPermission: (p) => perms.includes(p) })
  function mountWith({ perms = ['orders.redeliver'], over = {}, requests = [] } = {}) {
    const seen = { posts: [], lists: 0 }
    let rows = requests
    server.use(
      http.get(`${API}/api/orders/support/`, () => HttpResponse.json({ results: [row], recent: [] })),
      http.get(`${API}/api/orders/support/:id/`, () => HttpResponse.json(detail(over))),
      http.get(`${API}/api/delivery/redeliveries/`, () => { seen.lists += 1; return HttpResponse.json({ results: rows }) }),
      http.post(`${API}/api/delivery/redeliveries/`, async ({ request }) => {
        const body = await request.json()
        seen.posts.push(body)
        rows = [{ id: 5, order: 1, attempt: 1, status: 'awaiting_payment', status_label: 'Waiting for the customer to pay', fee: '15.00', reason: body.reason }]
        return HttpResponse.json(rows[0], { status: 201 })
      }),
    )
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={queryClient}><SupportOrderStatusPanel auth={auth(perms)} /></QueryClientProvider>)
    return seen
  }
  const openDetail = async () => { fireEvent.click(await screen.findByRole('listitem')); await screen.findByText('Order #1') }

  it('shows the re-delivery action only with orders.redeliver and redeliverable true', async () => {
    const seen = mountWith({ perms: [], over: { redeliverable: true, redelivery_fee: '15.00' } })
    await openDetail()
    expect(screen.queryByRole('region', { name: "Re-deliver at the customer's request" })).not.toBeInTheDocument()
    expect(seen.lists).toBe(0)
    cleanup()
    const plain = mountWith({ over: { redeliverable: false } })
    await openDetail()
    await waitFor(() => expect(plain.lists).toBe(1))
    expect(screen.queryByRole('region', { name: "Re-deliver at the customer's request" })).not.toBeInTheDocument()
    cleanup()
    mountWith({ over: { redeliverable: true, redelivery_fee: '15.00' } })
    await openDetail()
    const section = await screen.findByRole('region', { name: "Re-deliver at the customer's request" })
    expect(within(section).getByText('GH₵ 15.00')).toBeInTheDocument()
  })

  it('requires a reason', async () => {
    const seen = mountWith({ over: { redeliverable: true, redelivery_fee: '15.00' } })
    await openDetail()
    const section = await screen.findByRole('region', { name: "Re-deliver at the customer's request" })
    const ask = within(section).getByRole('button', { name: 'Ask the customer to pay and deliver again' })
    expect(ask).toBeDisabled()
    fireEvent.change(within(section).getByLabelText(/Reason/), { target: { value: '   ' } })
    expect(ask).toBeDisabled()
    fireEvent.change(within(section).getByLabelText(/Reason/), { target: { value: 'Customer called, home tomorrow' } })
    fireEvent.click(ask)
    await waitFor(() => expect(seen.posts).toEqual([{ order: 1, reason: 'Customer called, home tomorrow' }]))
    expect(await within(section).findByText('Waiting for the customer to pay GH₵ 15.00.')).toBeInTheDocument()
  })

  it('shows waiting for payment state', async () => {
    mountWith({
      over: { redeliverable: false },
      requests: [{ id: 5, order: 1, attempt: 1, status: 'awaiting_payment', status_label: 'Waiting', fee: '15.00', reason: 'x' }],
    })
    await openDetail()
    const section = await screen.findByRole('region', { name: "Re-deliver at the customer's request" })
    expect(within(section).getByRole('status')).toHaveTextContent('Waiting for the customer to pay GH₵ 15.00.')
    expect(within(section).getByRole('button', { name: 'Cancel the re-delivery' })).toBeInTheDocument()
    expect(within(section).queryByRole('button', { name: 'Ask the customer to pay and deliver again' })).not.toBeInTheDocument()
  })
})
