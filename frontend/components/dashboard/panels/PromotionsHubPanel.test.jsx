import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../../mocks/server.js'
import PromotionsHubPanel from './PromotionsHubPanel.jsx'

const API = 'http://localhost:8000'
const LISTINGS = [{ id: 9, name: 'Kente stole', status: 'published', price_amount: '100.00', variants: [] }, { id: 13, name: 'Draft thing', status: 'draft', price_amount: '5.00', variants: [] }]
const FREE_LINE = 'Free for now. Prices will be announced before any charge.'
const Pay = ({ amount, onSuccess }) => <button onClick={() => onSuccess('ref')}>PAY {amount}</button>

function renderHub(props = {}, { pricing = false } = {}) {
  server.use(
    http.get(`${API}/api/listings/mine/`, () => HttpResponse.json(LISTINGS)),
    http.get(`${API}/api/listings/promotions/pricing/`, () => HttpResponse.json({ enabled: pricing })),
  )
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><PromotionsHubPanel PaymentComponent={Pay} {...props} /></QueryClientProvider>)
}

describe('PromotionsHubPanel', () => {
  it('hub lists every tool', async () => {
    renderHub()
    for (const name of [/Discount/, /Hero ad/, /Sponsored ad/, /Free-delivery promo/, /Flash-sale invitations/]) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument()
    }
    expect(await screen.findByText(FREE_LINE)).toBeInTheDocument()
  })

  it('direct hides the owner-scoped cards', () => {
    renderHub({ direct: true })
    expect(screen.getByRole('button', { name: /Discount/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Sponsored ad/ })).toBeInTheDocument()
    for (const name of [/Hero ad/, /Free-delivery promo/, /Flash-sale invitations/]) expect(screen.queryByRole('button', { name })).not.toBeInTheDocument()
  })

  it('discount card opens the discounts panel', async () => {
    renderHub()
    fireEvent.click(screen.getByRole('button', { name: /Discount/ }))
    expect(await screen.findByLabelText('Item')).toBeInTheDocument()
  })

  it('hero card links to the Plan 1 screen', async () => {
    server.use(http.get(`${API}/api/hero/mine/slides/`, () => HttpResponse.json([])))
    renderHub()
    fireEvent.click(screen.getByRole('button', { name: /Hero ad/ }))
    expect(await screen.findByRole('form', { name: 'New hero slide' })).toBeInTheDocument()
  })

  it('sponsored request skips payment when free', async () => {
    let url = null, body = null
    server.use(http.post(`${API}/api/listings/9/promote/`, async ({ request }) => {
      url = request.url; body = await request.json()
      return HttpResponse.json({ id: 4, listing: 9, kind: 'featured', amount_paid: '0.00', status: 'pending', free: true }, { status: 201 })
    }))
    renderHub()
    fireEvent.click(screen.getByRole('button', { name: /Sponsored ad/ }))
    await screen.findByRole('option', { name: 'Kente stole' })
    fireEvent.change(screen.getByLabelText('Listing'), { target: { value: '9' } })
    fireEvent.click(screen.getByText('📣 Promote 7d'))
    await waitFor(() => expect(body).toEqual({ kind: 'featured', days: 7 }))
    expect(await screen.findByText(/Sent for review/)).toBeInTheDocument()
    expect(screen.queryByText(/^PAY/)).not.toBeInTheDocument()
  })

  it('sponsored request keeps the pay step when not free', async () => {
    server.use(http.post(`${API}/api/listings/9/promote/`, () => HttpResponse.json({ id: 4, listing: 9, kind: 'featured', amount_paid: '35.00', status: 'pending', free: false }, { status: 201 })))
    renderHub({ listingId: 9 }, { pricing: true })
    fireEvent.click(await screen.findByText('📣 Promote 7d'))
    expect(await screen.findByText('PAY 35')).toBeInTheDocument()
  })

  it('a scoped hub posts to the given promote base', async () => {
    let hit = false
    server.use(http.post(`${API}/api/direct/listings/9/promote/`, () => { hit = true; return HttpResponse.json({ id: 1, free: true, amount_paid: '0.00' }, { status: 201 }) }))
    renderHub({ listingId: 9, promoteBase: '/api/direct/listings', basePath: '/api/direct/listings' })
    fireEvent.click(await screen.findByText('📣 Promote 7d'))
    await waitFor(() => expect(hit).toBe(true))
  })

  it('shows no price text when pricing is on and none is configured', async () => {
    const { container } = renderHub({}, { pricing: true })
    fireEvent.click(screen.getByRole('button', { name: /Sponsored ad/ }))
    await screen.findByLabelText('Listing')
    await waitFor(() => expect(screen.queryByText(FREE_LINE)).not.toBeInTheDocument())
    expect(container.textContent).not.toMatch(/GH₵\s*\d|GHS\s*\d|per day/)
    expect(screen.queryByText(/Free for now/)).not.toBeInTheDocument()
  })

  it('lists flash-sale invitations read-only, with an honest empty state', async () => {
    renderHub()
    fireEvent.click(screen.getByRole('button', { name: /Flash-sale invitations/ }))
    expect(await screen.findByText(/No flash-sale invitations yet/)).toBeInTheDocument()
  })

  it('shows an invitation from the owner endpoint', async () => {
    server.use(http.get(`${API}/api/marketing/owner/flash-sales/`, () => HttpResponse.json({ results: [{ sale_id: 3, name: 'Friday flash', discount_pct: 20, starts_at: '2030-01-01T10:00:00Z', ends_at: '2030-01-01T12:00:00Z', answer: 'asked', listings: [{ id: 9, name: 'Kente stole', normal_price: '100.00', sale_price: '80.00', state: 'asked' }] }] })))
    renderHub()
    fireEvent.click(screen.getByRole('button', { name: /Flash-sale invitations/ }))
    expect(await screen.findByText(/Friday flash/)).toBeInTheDocument()
    expect(screen.getByText(/Waiting for your answer/)).toBeInTheDocument()
  })
})
