import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import ServicesPanel from './ServicesPanel.jsx'
import { server } from '../../../mocks/server.js'

const API = 'http://localhost:8000'
const REQUEST = {
  id: 7, listing_name: 'Home tiling', customer_name: 'Yaw Boateng', created_at: '2026-10-20T09:00:00Z',
  message: 'Two rooms please', status: 'requested', budget: null, agreed_price: null,
}

function renderPanel({ respond } = {}) {
  let incomingCalls = 0
  server.use(
    http.get(`${API}/api/listings/mine/`, () => HttpResponse.json([])),
    http.get(`${API}/api/services/requests/incoming/`, () => {
      incomingCalls += 1
      return HttpResponse.json([REQUEST])
    }),
    http.post(`${API}/api/services/requests/:id/respond/`, respond),
  )
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={queryClient}><ServicesPanel /></QueryClientProvider>)
  return { incomingCalls: () => incomingCalls }
}

describe('ServicesPanel quote and decline', () => {
  it("a refused quote shows the server's price message", async () => {
    let sent
    renderPanel({
      respond: async ({ request }) => {
        sent = await request.json()
        return HttpResponse.json({ price: 'Enter a price in GH₵ above 0.00, like 150.00.' }, { status: 400 })
      },
    })
    fireEvent.click(await screen.findByText(/Accept & quote/))
    fireEvent.change(screen.getByPlaceholderText('Your price (GHS)'), { target: { value: ' 0 ' } })
    fireEvent.click(screen.getByText('Send quote'))
    expect(await screen.findByText('Enter a price in GH₵ above 0.00, like 150.00.')).toBeInTheDocument()
    expect(sent).toEqual({ action: 'accept', price: '0' })
  })

  it('a decline refusal shows the server detail', async () => {
    renderPanel({
      respond: () => HttpResponse.json({ detail: 'This request was already answered.' }, { status: 409 }),
    })
    fireEvent.click(await screen.findByText(/Decline/))
    fireEvent.click(screen.getByText('Confirm decline'))
    expect(await screen.findByText('This request was already answered.')).toBeInTheDocument()
  })

  it('a quote that is accepted closes the form and refetches', async () => {
    const view = renderPanel({ respond: () => HttpResponse.json({ id: 7, status: 'accepted' }) })
    fireEvent.click(await screen.findByText(/Accept & quote/))
    fireEvent.change(screen.getByPlaceholderText('Your price (GHS)'), { target: { value: '150.00' } })
    fireEvent.click(screen.getByText('Send quote'))
    await waitFor(() => expect(screen.queryByPlaceholderText('Your price (GHS)')).not.toBeInTheDocument())
    await waitFor(() => expect(view.incomingCalls()).toBe(2))
  })
})
