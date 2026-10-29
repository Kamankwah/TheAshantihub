import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../../mocks/server.js'
import AshantiDirectPanel from './AshantiDirectPanel.jsx'

const API = 'http://localhost:8000'
const HEADER = 'You are working in Ashanti Direct. Money follows the normal fee, wallet and payout rules.'
const SERVICE_CAT = { id: 4, slug: 'tours', label: 'Tours', icon: '🚌', kind: 'service', is_accommodation: false, parent: null }
const ZONE = { id: 2, name: 'Adum' }

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><AshantiDirectPanel /></QueryClientProvider>)
}

describe('AshantiDirectPanel', () => {
  it('panel creates a listing through the direct base path', async () => {
    let posted = null
    let hitOwnerPath = false
    let rows = []
    server.use(
      http.get(`${API}/api/listings/categories/`, () => HttpResponse.json([SERVICE_CAT])),
      http.get(`${API}/api/listings/zones/`, () => HttpResponse.json([ZONE])),
      http.get(`${API}/api/direct/listings/`, () => HttpResponse.json(rows)),
      http.get(`${API}/api/listings/mine/`, () => { hitOwnerPath = true; return HttpResponse.json([]) }),
      http.post(`${API}/api/direct/listings/`, async ({ request }) => {
        posted = await request.json()
        const row = { id: 77, name: posted.name, status: 'draft', price_amount: null, price_unit: 'per service', photos: [], variants: [], category: 4 }
        rows = [row]
        return HttpResponse.json(row, { status: 201 })
      }),
    )
    renderPanel()
    expect(screen.getByText(HEADER)).toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: /List a New Product \/ Service/ }))
    await screen.findByRole('option', { name: /Tours/ })
    const selects = document.querySelectorAll('select')
    fireEvent.change(selects[0], { target: { value: '4' } })
    fireEvent.change(selects[1], { target: { value: '2' } })
    fireEvent.change(screen.getByPlaceholderText('e.g. Hand-woven Kente Scarf'), { target: { value: 'City tour' } })
    fireEvent.change(screen.getByPlaceholderText(/Describe what you're offering/), { target: { value: 'A walking tour' } })
    fireEvent.click(screen.getByRole('button', { name: /Create Listing/ }))
    await waitFor(() => expect(posted).not.toBeNull())
    expect(posted.name).toBe('City tour')
    expect(hitOwnerPath).toBe(false)
  })

  it('a new direct listing says a second person must approve', async () => {
    server.use(
      http.get(`${API}/api/direct/listings/`, () => HttpResponse.json([
        { id: 77, name: 'City tour', status: 'draft', price_amount: null, price_unit: 'per service', photos: [], variants: [], category: 4 },
        { id: 78, name: 'Live thing', status: 'published', price_amount: '5.00', price_unit: 'per item', photos: [], variants: [], category: 4 },
      ])),
    )
    renderPanel()
    expect(await screen.findByText('Needs a second person to approve')).toBeInTheDocument()
    expect(screen.getAllByText('Needs a second person to approve')).toHaveLength(1)
  })

  it('shows no payout, wallet, hero or WhatsApp controls', async () => {
    server.use(http.get(`${API}/api/direct/listings/`, () => HttpResponse.json([])))
    renderPanel()
    await screen.findByText(/don't have any listings yet/)
    expect(screen.queryByText(/WhatsApp/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Hero/)).not.toBeInTheDocument()
    expect(screen.queryByText(/payout details|Wallet balance|Withdraw/i)).not.toBeInTheDocument()
  })

  it('the Promote tab uses the direct hub without owner-only cards', async () => {
    server.use(http.get(`${API}/api/direct/listings/`, () => HttpResponse.json([])))
    renderPanel()
    fireEvent.click(screen.getByRole('tab', { name: 'Promote' }))
    expect(await screen.findByRole('button', { name: /Sponsored ad/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Hero ad/ })).not.toBeInTheDocument()
  })

  it('the Services tab does not ask for a business owner service-request inbox', async () => {
    let asked = false
    server.use(
      http.get(`${API}/api/direct/listings/`, () => HttpResponse.json([])),
      http.get(`${API}/api/services/requests/incoming/`, () => { asked = true; return HttpResponse.json({ detail: 'no' }, { status: 403 }) }),
    )
    renderPanel()
    fireEvent.click(screen.getByRole('tab', { name: 'Services' }))
    expect(await screen.findByText('Your service listings')).toBeInTheDocument()
    expect(screen.queryByText('Service requests')).not.toBeInTheDocument()
    expect(asked).toBe(false)
  })
})
