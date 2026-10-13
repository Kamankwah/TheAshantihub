import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../../../mocks/server.js'
import SupportDisputeIntakePanel from '../SupportDisputeIntakePanel.jsx'

const API = 'http://localhost:8000'
const dispute = (over = {}) => ({
  id: 9, order: 9, order_total_amount: '3150.00', order_status: 'paid', raised_by: 4, raised_by_kind: 'customer', customer_name: 'Kwesi Amoako', businesses: ['Kejetia Phone Hub'],
  reason: 'quality_issue', problem_type: 'faulty_item', customer_ask: '', intake_summary: '', description: "It won't charge.", status: 'open', conversation: null, conversation_label: null,
  flagged_by_name: null, resolved_by_name: null, created_at: '2026-10-07T10:16:00Z', updated_at: '2026-10-07T10:16:00Z', evidence: [], records: [{ key: 'words', title: "Customer's own words", detail: "It won't charge.", at: '2026-10-07T10:16:00Z' }], ...over,
})

function setup(rows = [dispute()], seen = { calls: [], urls: [] }) {
  server.use(
    http.get(`${API}/api/disputes/counts/`, () => HttpResponse.json({ needs_intake: 1, with_accounting: 2, decided_this_week: 1 })),
    http.get(`${API}/api/disputes/:id/`, ({ params }) => HttpResponse.json(rows.find((r) => String(r.id) === params.id) || {}, { status: 200 })),
    http.get(`${API}/api/disputes/`, ({ request }) => {
      seen.urls.push(request.url)
      const status = new URL(request.url).searchParams.get('status')
      const pick = rows.filter((r) => (status === 'pending' ? ['open', 'investigating'].includes(r.status) : status === 'approved' ? r.status === 'resolved' : r.status === 'rejected'))
      return HttpResponse.json({ count: pick.length, next: null, previous: null, results: pick })
    }),
    http.patch(`${API}/api/disputes/:id/intake/`, async ({ request }) => { seen.calls.push(['intake', await request.json()]); return HttpResponse.json(rows[0]) }),
    http.post(`${API}/api/disputes/:id/flag/`, async ({ request }) => { seen.calls.push(['flag', await request.json()]); return HttpResponse.json({ id: 9 }) }),
    http.post(`${API}/api/disputes/log/`, async ({ request }) => { seen.calls.push(['log', await request.json()]); return HttpResponse.json(dispute({ id: 12 }), { status: 201 }) }),
  )
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const view = render(<QueryClientProvider client={queryClient}><SupportDisputeIntakePanel /></QueryClientProvider>)
  return { seen, view }
}

describe('SupportDisputeIntakePanel', () => {
  it('lists disputes as Customer or Staff-logged with the real statuses only', async () => {
    setup([dispute(), dispute({ id: 10, status: 'investigating', raised_by_kind: 'staff', flagged_by_name: 'Esi Nyarko' }), dispute({ id: 11, status: 'resolved' })])
    expect(await screen.findByText('1 needs intake · 2 with Accounting · 1 decided this week')).toBeInTheDocument()
    expect(await screen.findByText('Needs intake')).toBeInTheDocument()
    expect(screen.getByText('With Accounting')).toBeInTheDocument()
    expect(screen.getByText('Staff-logged')).toBeInTheDocument()
    expect(screen.queryByText(/asked for evidence/i)).not.toBeInTheDocument()
    expect(screen.queryByText('Rider')).not.toBeInTheDocument()
  })

  it('cannot flag without a summary, then saves the intake and flags with it', async () => {
    const { seen } = setup()
    fireEvent.click(await screen.findByRole('button', { name: '#9' }))
    const detail = await screen.findByRole('region', { name: 'Dispute 9' })
    expect(within(detail).getByText("Customer's own words")).toBeInTheDocument()
    const flag = within(detail).getByRole('button', { name: 'Flag for investigation' })
    expect(flag).toBeDisabled()
    fireEvent.change(within(detail).getByLabelText('Summary for Accounting'), { target: { value: 'Phone will not charge.' } })
    fireEvent.change(within(detail).getByLabelText('Customer is asking for'), { target: { value: 'money_back' } })
    fireEvent.click(flag)
    await waitFor(() => expect(seen.calls.map(([k]) => k)).toEqual(['intake', 'flag']))
    expect(seen.calls[1][1]).toEqual({ intake_summary: 'Phone will not charge.' })
    expect(seen.calls[0][1]).toMatchObject({ customer_ask: 'money_back', intake_summary: 'Phone will not charge.' })
  })

  it('offers no evidence deletion', async () => {
    setup([dispute({ evidence: [{ id: 1, kind: 'note', title: 'Business answer', body: 'No answer', file_url: null, added_by_name: 'Esi Nyarko', created_at: '2026-10-07T11:00:00Z' }] })])
    fireEvent.click(await screen.findByRole('button', { name: '#9' }))
    const detail = await screen.findByRole('region', { name: 'Dispute 9' })
    expect(within(detail).getByText('Business answer')).toBeInTheDocument()
    expect(within(detail).queryByRole('button', { name: /delete|remove/i })).not.toBeInTheDocument()
  })

  it('uses the ?order= deep link to filter the list and prefill the log form', async () => {
    window.history.pushState({}, '', '/staff/disputes?order=9')
    const { seen } = setup()
    expect(await screen.findByText('Disputes on order #9')).toBeInTheDocument()
    await waitFor(() => expect(seen.urls.some((u) => new URL(u).searchParams.get('order') === '9')).toBe(true))
    const form = screen.getByRole('region', { name: 'Log a dispute' })
    expect(within(form).getByLabelText('Order number')).toHaveValue('9')
    fireEvent.change(within(form).getByLabelText('What the customer said'), { target: { value: 'Rang to say it never came.' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Log dispute' }))
    await waitFor(() => expect(seen.calls[0]).toEqual(['log', { order: 9, description: 'Rang to say it never came.' }]))
    window.history.pushState({}, '', '/')
  })
})
