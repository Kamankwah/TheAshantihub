import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../../mocks/server.js'
import DiscountsPanel from './DiscountsPanel.jsx'

const API = 'http://localhost:8000'
const LISTINGS = [
  { id: 9, name: 'Kente stole', status: 'published', price_amount: '100.00', variants: [] },
  { id: 12, name: 'Cake', status: 'published', price_amount: '50.00', variants: [{ id: 3, label: 'Small', price_amount: '50.00', is_active: true }] },
  { id: 13, name: 'Draft thing', status: 'draft', price_amount: '5.00', variants: [] },
]
const ROW = { target: 'listing', variant: null, label: null, regular_price: '100.00', sale_price: '80.00', percent_off: 20, ends_at: null }

function renderPanel(props = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><DiscountsPanel listings={LISTINGS} {...props} /></QueryClientProvider>)
}
const choose = (id) => fireEvent.change(screen.getByLabelText('Item'), { target: { value: String(id) } })

describe('DiscountsPanel', () => {
  it('creates a percent discount', async () => {
    let body = null
    let running = []
    server.use(
      http.get(`${API}/api/listings/mine/9/discounts/`, () => HttpResponse.json(running)),
      http.post(`${API}/api/listings/mine/9/discounts/`, async ({ request }) => { body = await request.json(); running = [ROW]; return HttpResponse.json(running, { status: 201 }) }),
    )
    renderPanel()
    expect(screen.queryByRole('option', { name: 'Draft thing' })).not.toBeInTheDocument()
    choose(9)
    fireEvent.change(screen.getByLabelText('Percent (1 to 90)'), { target: { value: '20' } })
    expect(await screen.findByText('Shoppers will see GH₵ 80.00.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Start discount' }))
    await waitFor(() => expect(body).toEqual({ percent_off: '20' }))
    expect(await screen.findByText(/GH₵ 80.00 instead of GH₵ 100.00 \(20% off\)/)).toBeInTheDocument()
  })

  it('sends the chosen variant and an optional end date', async () => {
    let body = null
    server.use(http.post(`${API}/api/listings/mine/12/discounts/`, async ({ request }) => { body = await request.json(); return HttpResponse.json([], { status: 201 }) }))
    renderPanel()
    choose(12)
    fireEvent.change(screen.getByLabelText('Variant'), { target: { value: '3' } })
    fireEvent.click(screen.getByLabelText('Sale price'))
    fireEvent.change(screen.getByLabelText('Sale price (GH₵)'), { target: { value: '40' } })
    fireEvent.change(screen.getByLabelText('Ends (optional)'), { target: { value: '2030-01-02T10:00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Start discount' }))
    await waitFor(() => expect(body).not.toBeNull())
    expect(body.variant).toBe(3)
    expect(body.sale_price).toBe('40')
    expect(body.ends_at).toBe(new Date('2030-01-02T10:00').toISOString())
  })

  it('shows the conflict message from the server', async () => {
    server.use(http.post(`${API}/api/listings/mine/9/discounts/`, () => HttpResponse.json({ detail: 'This already has a discount running. End it before starting a new one.' }, { status: 409 })))
    renderPanel()
    choose(9)
    fireEvent.change(screen.getByLabelText('Percent (1 to 90)'), { target: { value: '10' } })
    fireEvent.click(screen.getByRole('button', { name: 'Start discount' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('This already has a discount running. End it before starting a new one.')
  })

  it('end posts and refetches', async () => {
    let ended = null
    let running = [ROW]
    server.use(
      http.get(`${API}/api/listings/mine/9/discounts/`, () => HttpResponse.json(running)),
      http.post(`${API}/api/listings/mine/9/discounts/end/`, async ({ request }) => { ended = await request.json(); running = []; return HttpResponse.json([]) }),
    )
    renderPanel()
    choose(9)
    fireEvent.click(await screen.findByRole('button', { name: 'End discount' }))
    await waitFor(() => expect(ended).toEqual({}))
    expect(await screen.findByText(/No discount is running on this item/)).toBeInTheDocument()
  })

  it('does not preview a price outside the allowed range', async () => {
    renderPanel()
    choose(9)
    fireEvent.change(screen.getByLabelText('Percent (1 to 90)'), { target: { value: '95' } })
    expect(await screen.findByText(/outside what is allowed/)).toBeInTheDocument()
    expect(screen.queryByText(/Shoppers will see/)).not.toBeInTheDocument()
  })

  it('explains the 7-day rule honestly', () => {
    renderPanel()
    expect(screen.getByText(/Struck-through original price shows only after 7 days of the same price/)).toBeInTheDocument()
  })

  it('reads the owner listings itself and honours basePath', async () => {
    server.use(
      http.get(`${API}/api/direct/listings/`, () => HttpResponse.json([LISTINGS[0]])),
      http.get(`${API}/api/direct/listings/9/discounts/`, () => HttpResponse.json([ROW])),
    )
    renderPanel({ listings: undefined, basePath: '/api/direct/listings' })
    expect(await screen.findByRole('option', { name: 'Kente stole' })).toBeInTheDocument()
    choose(9)
    expect(await screen.findByText(/instead of GH₵ 100.00/)).toBeInTheDocument()
  })
})
