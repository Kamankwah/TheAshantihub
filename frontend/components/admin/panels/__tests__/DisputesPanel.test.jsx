import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../../../mocks/server.js'
import DisputesPanel from '../DisputesPanel.jsx'

const DISPUTE = {
  id: 9, order: 41, reason: 'not_received', description: 'Never arrived', status: 'open',
  raised_by_name: 'Ama', created_at: '2026-09-01T00:00:00Z',
}
const auth = { hasPermission: (c) => c === 'disputes.resolve_financial' }

function setup(dispute = DISPUTE) {
  const resolveBodies = []
  server.use(
    http.get('http://localhost:8000/api/disputes/', ({ request }) => {
      const status = new URL(request.url).searchParams.get('status')
      return HttpResponse.json({ count: 1, next: null, previous: null, results: status === 'pending' ? [dispute] : [] })
    }),
    http.post('http://localhost:8000/api/disputes/:id/resolve/', async ({ request }) => {
      resolveBodies.push(await request.json())
      return HttpResponse.json({ id: 9, status: 'rejected' })
    }),
  )
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={queryClient}><DisputesPanel auth={auth} /></QueryClientProvider>)
  return resolveBodies
}

describe('DisputesPanel Reject confirmation', () => {
  it('does not send the reject request until confirmed, then sends exactly one', async () => {
    const bodies = setup()
    fireEvent.click(await screen.findByText('✕ Reject'))
    expect(screen.getByText(/Reject this dispute\?/)).toBeInTheDocument()
    await new Promise((r) => setTimeout(r, 50))
    expect(bodies).toHaveLength(0)

    fireEvent.click(screen.getByRole('button', { name: 'Confirm reject' }))
    await waitFor(() => expect(bodies).toHaveLength(1))
    expect(bodies[0]).toMatchObject({ outcome: 'rejected' })
  })

  it('Keep sends nothing and restores the Reject button', async () => {
    const bodies = setup()
    fireEvent.click(await screen.findByText('✕ Reject'))
    fireEvent.click(screen.getByRole('button', { name: 'Keep' }))
    await new Promise((r) => setTimeout(r, 50))
    expect(bodies).toHaveLength(0)
    expect(screen.getByText('✕ Reject')).toBeInTheDocument()
    expect(screen.queryByText(/Reject this dispute\?/)).not.toBeInTheDocument()
  })

  it('never sends a typed refund with a reject', async () => {
    const bodies = setup()
    fireEvent.click(await screen.findByText('✓ Resolve'))
    fireEvent.change(screen.getByPlaceholderText('Refund amount (optional)'), { target: { value: '25.00' } })
    fireEvent.click(screen.getByText('✕ Reject'))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm reject' }))
    await waitFor(() => expect(bodies).toHaveLength(1))
    expect(bodies[0]).toMatchObject({ outcome: 'rejected', refund_amount: null })
  })
})

describe('DisputesPanel refundable amount', () => {
  it('shows "Can still be refunded" from order_refundable_amount and hides it when null', async () => {
    setup({ ...DISPUTE, order_total_amount: '105.00', order_refundable_amount: '90.00' })
    expect(await screen.findByText(/Can still be refunded GHS 90\.00/)).toBeInTheDocument()
  })

  it('hides "Can still be refunded" when order_refundable_amount is null', async () => {
    setup({ ...DISPUTE, order_total_amount: '105.00', order_refundable_amount: null })
    expect(await screen.findByText(/Order total GHS 105\.00/)).toBeInTheDocument()
    expect(screen.queryByText(/Can still be refunded/)).not.toBeInTheDocument()
  })
})

describe('DisputesPanel whole refund at GH₵ 0.00', () => {
  const ZERO = { ...DISPUTE, order_total_amount: '5.00', order_refundable_amount: '0.00', order_whole_refund_at_zero: true }

  it('offers a whole-order refund when nothing is left to give the customer, and sends whole_refund without an amount', async () => {
    const bodies = setup(ZERO)
    fireEvent.click(await screen.findByText('✓ Resolve'))
    fireEvent.click(screen.getByLabelText(/Refund the whole order/))
    expect(screen.getByPlaceholderText('Refund amount (optional)')).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm resolve' }))
    await waitFor(() => expect(bodies).toHaveLength(1))
    expect(bodies[0]).toMatchObject({ outcome: 'resolved', refund_amount: null, whole_refund: true })
  })

  it('does not offer it otherwise, and a plain resolve sends whole_refund false', async () => {
    const bodies = setup({ ...DISPUTE, order_refundable_amount: '90.00', order_whole_refund_at_zero: false })
    fireEvent.click(await screen.findByText('✓ Resolve'))
    expect(screen.queryByLabelText(/Refund the whole order/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm resolve' }))
    await waitFor(() => expect(bodies).toHaveLength(1))
    expect(bodies[0]).toMatchObject({ outcome: 'resolved', whole_refund: false })
  })
})
