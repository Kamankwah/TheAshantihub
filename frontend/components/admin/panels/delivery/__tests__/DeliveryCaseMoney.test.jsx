import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../../../../mocks/server.js'
import DisputesCases from '../DisputesCasesPanel.jsx'

const API = 'http://localhost:8000'
const wrap = (ui) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>)

const caseData = (order = {}, over = {}) => ({
  case: { id: 31, order_id: 7, case_type: 'not_received', case_type_label: 'Not received', status: 'open', status_label: 'Open', created_at: '2026-10-13T09:00:00Z', answer_due_at: null, minutes_left: null, overdue: false },
  description: 'Never arrived', reason: 'delivery_issue', order: { id: 7, total: '120.00', address: 'Ahodwo', ...order },
  evidence: null, rider: null, decision: null, refund: null,
  outcomes: { refund: 'Refund the customer', no_refund: 'No refund' }, faults: { rider: 'Rider', none: 'No one' },
  payments: 'Payments are simulated until a payment provider is connected: a refund is recorded and approved, no money moves.',
  ...over,
})
const open = async (data) => {
  server.use(http.get(`${API}/api/delivery/cases/31/`, () => HttpResponse.json(data)))
  wrap(<DisputesCases detailId="31" onOpenDetail={() => {}} />)
  await screen.findByText('Your decision')
  fireEvent.click(screen.getByLabelText('Refund the customer'))
}
const WHOLE = /Refund the whole order\. The customer gets GH₵ 0\.00 back/

describe('delivery case money', () => {
  it('shows what can still be refunded from the server', async () => {
    await open(caseData({ refundable: '90.00' }))
    expect(screen.getByText('Can still be refunded: GH₵ 90.00')).toBeInTheDocument()
  })

  it('caps the amount label at the refundable amount, else the order total', async () => {
    await open(caseData({ refundable: '90.00' }))
    expect(screen.getByLabelText(/Refund amount \(GH₵, at most GH₵ 90\.00\)/)).toBeInTheDocument()
  })

  it('caps the amount label at the order total without a refundable figure', async () => {
    await open(caseData())
    expect(screen.getByLabelText(/at most GH₵ 120\.00/)).toBeInTheDocument()
    expect(screen.queryByText(/Can still be refunded/)).not.toBeInTheDocument()
  })

  it('says the kept delivery fee is not refunded', async () => {
    await open(caseData({ refundable: '10.00', delivery_fee_kept: '15.00' }))
    expect(screen.getByText('The GH₵ 15.00 delivery fee is not refunded: the goods were picked up or delivered, so the fee is earned.')).toBeInTheDocument()
  })

  it('says nothing about a kept fee of 0.00', async () => {
    await open(caseData({ refundable: '10.00', delivery_fee_kept: '0.00' }))
    expect(screen.queryByText(/delivery fee is not refunded/)).not.toBeInTheDocument()
  })

  it('names who pays a free delivery', async () => {
    await open(caseData({ free_delivery: { amount: '15.00', funded_by: 'platform' } }))
    expect(screen.getByText('Delivery was free for the customer: a promo paid by AshantiHub covers the GH₵ 15.00 fee.')).toBeInTheDocument()
  })

  it('names the business when it funds the free delivery', async () => {
    await open(caseData({ free_delivery: { amount: '15.00', funded_by: 'business' } }))
    expect(screen.getByText('Delivery was free for the customer: a promo paid by the business covers the GH₵ 15.00 fee.')).toBeInTheDocument()
  })

  it('offers the whole-order refund only when the server says so', async () => {
    await open(caseData({ refundable: '0.00', whole_refund_at_zero: false }))
    expect(screen.queryByLabelText(WHOLE)).not.toBeInTheDocument()
  })

  it('a whole refund posts whole_refund true and no amount', async () => {
    let body
    server.use(http.post(`${API}/api/delivery/cases/31/decide/`, async ({ request }) => { body = await request.json(); return HttpResponse.json({ id: 31, status: 'resolved', refund_approval_id: 5 }) }))
    await open(caseData({ refundable: '0.00', whole_refund_at_zero: true }))
    const record = screen.getByRole('button', { name: 'Record decision' })
    fireEvent.click(screen.getByLabelText('Rider'))
    fireEvent.change(screen.getByLabelText(/Note \(required/), { target: { value: 'Lost' } })
    expect(record).toBeDisabled()
    fireEvent.click(screen.getByLabelText(WHOLE))
    expect(record).toBeEnabled()
    fireEvent.click(record)
    await waitFor(() => expect(body).toEqual({ outcome: 'refund', fault: 'rider', note: 'Lost', whole_refund: true, stop_rider_jobs: false, send_to_operations: false }))
  })

  it('the amount field is disabled while whole refund is ticked', async () => {
    await open(caseData({ refundable: '0.00', whole_refund_at_zero: true }))
    const amount = screen.getByLabelText(/Refund amount/)
    expect(amount).toBeEnabled()
    fireEvent.click(screen.getByLabelText(WHOLE))
    expect(amount).toBeDisabled()
    fireEvent.click(screen.getByLabelText(WHOLE))
    expect(amount).toBeEnabled()
  })

  it("money copy is the server's payments text", async () => {
    const text = "A refund is paid into the customer's AshantiHub wallet once a Super Admin approves it."
    await open(caseData({ refundable: '90.00' }, { payments: text }))
    expect(screen.getByText(new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))).toBeInTheDocument()
  })

  it('a recorded whole refund reads as a whole-order refund', async () => {
    const data = caseData({}, {
      decision: { outcome: 'refund', outcome_label: 'Refund the customer', fault: 'rider', note: 'Lost', decided_at: '2026-10-13T10:00:00Z', decided_by: { full_name: 'Adwoa Sarpong' }, refund_amount: '0.00' },
      refund: { approval_id: 5, status: 'pending', amount: '0.00', whole: true, asked_by: 'Adwoa Sarpong', decided_by: null },
      payments: 'Paid to the wallet.',
    })
    server.use(http.get(`${API}/api/delivery/cases/31/`, () => HttpResponse.json(data)))
    wrap(<DisputesCases detailId="31" onOpenDetail={() => {}} />)
    expect(await screen.findByText('Decision recorded')).toBeInTheDocument()
    expect(screen.getByText(/Whole-order refund/, { selector: 'div' })).toBeInTheDocument()
    expect(screen.getByText(/Refund request #5: whole-order refund \(nothing to give back\) · pending · asked by Adwoa Sarpong\. Paid to the wallet\./)).toBeInTheDocument()
    expect(screen.queryByText(/GH₵ 0\.00/)).not.toBeInTheDocument()
  })
})
