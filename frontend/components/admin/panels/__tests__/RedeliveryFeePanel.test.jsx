import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../../../mocks/server.js'
import RedeliveryFeePanel from '../RedeliveryFeePanel.jsx'

// Director ruling 1 (2026-10-20): Operations changes the re-delivery fee; another Operations lead or a Super Admin approves.
const API = 'http://localhost:8000'
const FEE = {
  key: 'redelivery_fee_pesewas', label: 'Re-delivery fee a customer pays to have an order delivered again after they were not available (pesewas)',
  value: 1500, default: 1500, is_default: true, nullable: false, minimum: 0, maximum: 20000, scheduled: [],
}
const wrap = (ui) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>)

describe('RedeliveryFeePanel', () => {
  it('shows the fee in force and sends a change for approval in pesewas', async () => {
    let body = null
    server.use(
      http.get(`${API}/api/ledger/settings/`, () => HttpResponse.json({ settings: [FEE], pending: [], history: [] })),
      http.post(`${API}/api/ledger/settings/`, async ({ request }) => { body = await request.json(); return HttpResponse.json({ approval_id: 4, status: 'pending' }, { status: 201 }) }),
    )
    wrap(<RedeliveryFeePanel />)
    const input = await screen.findByRole('textbox', { name: /Re-delivery fee a customer pays/ })
    expect(input).toHaveValue('15.00')
    expect(screen.getByText(/another Operations lead or a Super Admin approves/i)).toBeInTheDocument()
    fireEvent.change(input, { target: { value: '20' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(body).toEqual({ key: 'redelivery_fee_pesewas', value: 2000 }))
    expect(await screen.findByText('Sent for approval.')).toBeInTheDocument()
  })

  it('shows a change already waiting for approval', async () => {
    server.use(http.get(`${API}/api/ledger/settings/`, () => HttpResponse.json({
      settings: [FEE], pending: [{ id: 4, key: 'redelivery_fee_pesewas', value: 2000, maker: 'Ama Owusu', created_at: '2026-10-20T10:00:00Z' }], history: [],
    })))
    wrap(<RedeliveryFeePanel />)
    expect(await screen.findByText(/Waiting for approval: GH₵ 20.00, proposed by Ama Owusu/)).toBeInTheDocument()
  })

  it('says so when the fee cannot be loaded', async () => {
    server.use(http.get(`${API}/api/ledger/settings/`, () => HttpResponse.json({ detail: 'no' }, { status: 403 })))
    wrap(<RedeliveryFeePanel />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the re-delivery fee.')
  })
})
