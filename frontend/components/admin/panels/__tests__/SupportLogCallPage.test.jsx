import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { server } from '../../../../mocks/server.js'
import SupportLogCallPage from '../SupportLogCallPage.jsx'

const API = 'http://localhost:8000'
const FOUND = {
  customers: [{ id: 21, name: 'Yaw Mensah', phone_masked: '024 *** 553', orders: 3 }],
  businesses: [{ id: 9, business_name: 'Nanas Chop Bar', owner_name: 'Nana Adjei', phone_masked: '032 *** 118' }],
  orders: [{ id: 1, customer_id: 21, customer_name: 'Yaw Mensah', total_amount: '450.00', label: 'Order #1' }],
  prospects: [],
}

function renderPage(props = {}) {
  server.use(
    http.get(`${API}/api/calls/purposes/`, () => HttpResponse.json([{ value: 'order_question', label: 'Order question' }, { value: 'delivery', label: 'Delivery' }, { value: 'other', label: 'Other' }])),
    http.get(`${API}/api/calls/counterparts/`, () => HttpResponse.json(FOUND)),
  )
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const handlers = { onDone: vi.fn(), onSeeLog: vi.fn() }
  render(<QueryClientProvider client={queryClient}><SupportLogCallPage {...handlers} {...props} /></QueryClientProvider>)
  return handlers
}

describe('Support Log a call page', () => {
  it('finds a customer, links a conversation and saves with a follow-up', async () => {
    let body = null
    server.use(
      http.get(`${API}/api/messaging/staff/`, () => HttpResponse.json({ results: [{ id: 77, starter_name: 'Yaw Mensah', subject: 'Where is my rider' }] })),
      http.post(`${API}/api/calls/`, async ({ request }) => { body = await request.json(); return HttpResponse.json({ id: 5 }, { status: 201 }) }),
    )
    const { onSeeLog } = renderPage()
    fireEvent.change(await screen.findByLabelText('Find them'), { target: { value: 'yaw' } })
    fireEvent.click(await screen.findByRole('button', { name: /Yaw Mensah/ }))
    expect(screen.getByText(/Customer · 024 \*\*\* 553 · 3 orders/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Link a conversation, order or business'), { target: { value: 'yaw' } })
    fireEvent.click(await screen.findByRole('button', { name: /Conversation · Yaw Mensah: Where is my rider/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Connected' }))
    fireEvent.change(screen.getByLabelText('Length (min)'), { target: { value: '3' } })
    fireEvent.change(screen.getByLabelText('Length (s)'), { target: { value: '30' } })
    fireEvent.click(screen.getByLabelText('Remind me to follow up'))
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2099-01-02' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save call' }))
    await waitFor(() => expect(body).not.toBeNull())
    expect(body).toMatchObject({ counterpart_type: 'customer', counterpart_id: 21, direction: 'in', outcome: 'connected', duration_seconds: 210, related_type: 'messaging.conversation', related_id: '77' })
    expect(body.follow_up_at).toMatch(/^2099-01-02/)
    expect(body.counterpart_phone).toBeUndefined()
    expect(await screen.findByText('Call saved.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'See the call log' }))
    expect(onSeeLog).toHaveBeenCalled()
  }, 20000)

  it('degrades gracefully when conversation search is not available', async () => {
    server.use(http.get(`${API}/api/messaging/staff/`, () => HttpResponse.json({ detail: 'nope' }, { status: 500 })))
    renderPage()
    fireEvent.change(await screen.findByLabelText('Link a conversation, order or business'), { target: { value: 'yaw' } })
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByRole('button', { name: /Conversation ·/ })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Link a conversation, order or business')).toBeInTheDocument()
  })

  it('links an order by number', async () => {
    let body = null
    server.use(http.post(`${API}/api/calls/`, async ({ request }) => { body = await request.json(); return HttpResponse.json({ id: 6 }, { status: 201 }) }))
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Guest (no account)' }))
    fireEvent.change(screen.getByLabelText('Phone number'), { target: { value: '0541234377' } })
    fireEvent.change(screen.getByLabelText('Link a conversation, order or business'), { target: { value: '#1' } })
    expect(screen.queryByRole('button', { name: /Order #1/ })).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Link a conversation, order or business'), { target: { value: '#12' } })
    fireEvent.click(await screen.findByRole('button', { name: /Order #1 / }))
    fireEvent.click(screen.getByRole('button', { name: 'Save call' }))
    await waitFor(() => expect(body).not.toBeNull())
    expect(body).toMatchObject({ counterpart_type: 'guest', counterpart_phone: '0541234377', related_type: 'orders.order', related_id: '1' })
    expect(body.counterpart_id).toBeUndefined()
  })

  it('shows a business by name and masked number only, with no way to contact it', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Business owner' }))
    fireEvent.change(screen.getByLabelText('Find them'), { target: { value: 'chop' } })
    const result = await screen.findByRole('button', { name: /Nanas Chop Bar/ })
    expect(within(result).getByText(/032 \*\*\* 118/)).toBeInTheDocument()
    expect(screen.queryByText(/whatsapp.*business|wa\.me|tel:/i)).not.toBeInTheDocument()
    expect(screen.getByText(/never directly/)).toBeInTheDocument()
  })

  it('offers no Promised to pay outcome, asks who it was with, and shows where the call will show', async () => {
    renderPage()
    expect(screen.queryByRole('button', { name: 'Promised to pay' })).not.toBeInTheDocument()
    expect(await screen.findByRole('region', { name: 'Where this call will show' })).toHaveTextContent('Your end-of-day report, under calls by outcome')
    fireEvent.click(screen.getByRole('button', { name: 'Save call' }))
    expect(await screen.findByText('Find who you spoke to, or choose Guest or Someone else.')).toBeInTheDocument()
  })

  it('shows the server message when a save is refused', async () => {
    server.use(http.post(`${API}/api/calls/`, () => HttpResponse.json({ related_id: ["We couldn't find that record."] }, { status: 400 })))
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Someone else' }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Ama' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save call' }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })
})
