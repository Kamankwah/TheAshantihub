import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../../../../mocks/server.js'
import DeliveryManagerPanel from '../../DeliveryManagerPanel.jsx'

const API = 'http://localhost:8000'
const order = (over = {}) => ({ id: 9, customer_name: 'Ama', delivery_address: '12 Ash Rd', delivery_phone: '0200', items: [], delivery_assignment: null, ready_not_before: null, ...over })
const wrap = (ui) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>)

describe('Sending a held order early', () => {
  it('shows Send now with a reason box on a held order', async () => {
    let body = null
    server.use(
      http.get(`${API}/api/orders/delivery/`, () => HttpResponse.json({ count: 2, results: [order({ ready_not_before: new Date(Date.now() + 3600e3).toISOString() }), order({ id: 10 })] })),
      http.get(`${API}/api/orders/dispatches/`, () => HttpResponse.json([])),
      http.post(`${API}/api/delivery/orders/9/send-early/`, async ({ request }) => { body = await request.json(); return HttpResponse.json({ order_id: 9 }) }),
    )
    wrap(<DeliveryManagerPanel auth={{ hasPermission: (c) => c === 'delivery.manage' }} />)
    const open = await screen.findByRole('button', { name: 'Send now' })
    expect(screen.getAllByRole('button', { name: 'Send now' })).toHaveLength(1)
    fireEvent.click(open)
    const send = screen.getAllByRole('button', { name: 'Send now' })[0]
    expect(send).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/Why send it/), { target: { value: 'Shop is open' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Send now' })[0])
    await waitFor(() => expect(body).toEqual({ reason: 'Shop is open' }))
  })

  it('send now hidden without the permission', async () => {
    server.use(
      http.get(`${API}/api/orders/delivery/`, () => HttpResponse.json({ count: 1, results: [order({ ready_not_before: new Date(Date.now() + 3600e3).toISOString() })] })),
      http.get(`${API}/api/orders/dispatches/`, () => HttpResponse.json([])),
    )
    wrap(<DeliveryManagerPanel auth={{ hasPermission: (c) => c === 'orders.manage_delivery' }} />)
    expect(await screen.findByText(/Held until the shop opens/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Send now' })).not.toBeInTheDocument()
  })
})
