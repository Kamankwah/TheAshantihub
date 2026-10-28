import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../../../mocks/server.js'
import VerificationCallsPanel from '../VerificationCallsPanel.jsx'

const LOOKUP = 'http://localhost:8000/api/ledger/bookings/'
const CANCEL = 'http://localhost:8000/api/ledger/bookings/:id/cancel/'
const wrap = (ui) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>)
const support = { user: { role: 'support' }, hasPermission: (c) => c === 'orders.support_update' }
const verifyOnly = { user: { role: 'support' }, hasPermission: (c) => c === 'orders.verify' }
const sale = (over = {}) => ({
  sale_id: 7, kind: 'service', what: 'Home Cleaning', paid_at: '2026-10-20T10:00:00Z', business: 'Bright Cleaners',
  customer_name: 'Ama Mensah', customer_phone: '024 *** 2233', amount: '200.00', handed_over_at: null, cancellable: true,
  release_at: null, ...over,
})
const serve = (results) => server.use(http.get(LOOKUP, () => HttpResponse.json({ results })))

async function openCancel() {
  wrap(<VerificationCallsPanel auth={support} />)
  fireEvent.click(screen.getByRole('button', { name: 'Cancel a booking' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Cancel booking…' }))
  return screen.findByRole('textbox', { name: /reason/i })
}

describe('Cancel a booking', () => {
  it('cancel tab is hidden without orders.support_update', () => {
    wrap(<VerificationCallsPanel auth={verifyOnly} />)
    expect(screen.getByRole('button', { name: 'Bookings' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancel a booking' })).not.toBeInTheDocument()
  })

  it('lists open bookings with a masked phone', async () => {
    serve([sale()])
    wrap(<VerificationCallsPanel auth={support} />)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel a booking' }))
    expect(screen.getByRole('searchbox', { name: 'Sale, service request or booking number, customer name or phone, business' })).toBeInTheDocument()
    expect(await screen.findByText('Home Cleaning')).toBeInTheDocument()
    expect(screen.getByText('Service')).toBeInTheDocument()
    expect(screen.getByText('Bright Cleaners')).toBeInTheDocument()
    expect(screen.getByText('Ama Mensah')).toBeInTheDocument()
    expect(screen.getByText('024 *** 2233')).toBeInTheDocument()
    expect(screen.getByText('GH₵200.00')).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('searches with what was typed', async () => {
    const seen = []
    server.use(http.get(LOOKUP, ({ request }) => { seen.push(new URL(request.url).searchParams.get('q')); return HttpResponse.json({ results: [] }) }))
    wrap(<VerificationCallsPanel auth={support} />)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel a booking' }))
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: ' #12 ' } })
    await waitFor(() => expect(seen).toContain('#12'))
  })

  it('cancel needs a reason of at least three characters', async () => {
    serve([sale()])
    const reason = await openCancel()
    expect(screen.getByText("Refunds GH₵ 200.00 to Ama Mensah's AshantiHub wallet. The payment processing charge is not refunded. The customer and the business are told.")).toBeInTheDocument()
    const confirm = screen.getByRole('button', { name: 'Cancel and refund' })
    expect(confirm).toBeDisabled()
    fireEvent.change(reason, { target: { value: 'ab' } })
    expect(confirm).toBeDisabled()
    expect(screen.getByText('2/300')).toBeInTheDocument()
    fireEvent.change(reason, { target: { value: 'abc' } })
    expect(confirm).toBeEnabled()
  })

  it('cancel posts once and shows the refunded amount from the server', async () => {
    serve([sale()])
    const posts = []
    server.use(http.post(CANCEL, async ({ request, params }) => { posts.push({ id: params.id, body: await request.json() }); return HttpResponse.json({ sale: 7, refunded: '200.00' }) }))
    const reason = await openCancel()
    fireEvent.change(reason, { target: { value: 'Customer asked' } })
    const confirm = screen.getByRole('button', { name: 'Cancel and refund' })
    fireEvent.click(confirm)
    fireEvent.click(confirm)
    expect(await screen.findByText("Cancelled. GH₵ 200.00 went back to the customer's AshantiHub wallet.")).toHaveAttribute('role', 'status')
    expect(posts).toEqual([{ id: '7', body: { reason: 'Customer asked' } }])
  })

  it('a received booking offers no cancel', async () => {
    serve([sale({ cancellable: false, handed_over_at: '2026-10-21T09:00:00Z' })])
    wrap(<VerificationCallsPanel auth={support} />)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel a booking' }))
    expect(await screen.findByText(/^Received .*: a problem now is a dispute, not a cancel\.$/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancel booking…' })).not.toBeInTheDocument()
  })

  it('a refusal shows the server text', async () => {
    serve([sale()])
    server.use(http.post(CANCEL, () => HttpResponse.json({ detail: 'This booking was already refunded in full.' }, { status: 409 })))
    const reason = await openCancel()
    fireEvent.change(reason, { target: { value: 'Customer asked' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel and refund' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('This booking was already refunded in full.')
    expect(screen.getByRole('button', { name: 'Cancel and refund' })).toBeEnabled()
  })

  it('a reason refusal shows the server text', async () => {
    serve([sale()])
    server.use(http.post(CANCEL, () => HttpResponse.json({ reason: 'Say why it is cancelled (at least 3 characters).' }, { status: 400 })))
    const reason = await openCancel()
    fireEvent.change(reason, { target: { value: 'Customer asked' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel and refund' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Say why it is cancelled (at least 3 characters).')
  })
})
