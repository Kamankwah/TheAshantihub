import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import DeliveryPromosPanel from './DeliveryPromosPanel.jsx'
import { server } from '../../../mocks/server.js'

const PROMO = {
  id: 4, name: 'Free delivery weekend', business: 'Kente House', starts_at: '2026-10-14T08:00:00Z', ends_at: '2026-10-16T08:00:00Z',
  all_items: false, listings: [{ id: 9, name: 'Stole' }], status: 'active', effective_status: 'active', live: false, rejection_reason: '', covered_total: '30.00', covered_orders: 2,
}

function renderPanel(results, extra = []) {
  server.use(http.get('http://localhost:8000/api/marketing/owner/delivery-promos/', () => HttpResponse.json({ results })), ...extra)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}><DeliveryPromosPanel /></QueryClientProvider>)
}

describe('DeliveryPromosPanel', () => {
  it('says so when there are no promos instead of showing a figure', async () => {
    renderPanel([])
    expect(await screen.findByText(/no free-delivery promos yet/i)).toBeInTheDocument()
  })

  it('lists the business\'s own promo with its items and offers Pause', async () => {
    renderPanel([PROMO])
    expect(await screen.findByText('Free delivery weekend')).toBeInTheDocument()
    expect(screen.getByText('Stole')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument()
  })

  it('shows a not-approved promo with its reason and no actions', async () => {
    renderPanel([{ ...PROMO, status: 'rejected', effective_status: 'rejected', rejection_reason: 'Too long' }])
    expect(await screen.findByText(/Reason: Too long/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Pause' })).not.toBeInTheDocument()
  })

  it('pauses through the API and shows the server error when it refuses', async () => {
    let hit = null
    renderPanel([PROMO], [http.post('http://localhost:8000/api/marketing/owner/delivery-promos/4/pause/', () => { hit = true; return HttpResponse.json({ detail: 'Only an approved promo can be paused.' }, { status: 409 }) })])
    fireEvent.click(await screen.findByRole('button', { name: 'Pause' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Only an approved promo can be paused.')
    expect(hit).toBe(true)
  })
})
