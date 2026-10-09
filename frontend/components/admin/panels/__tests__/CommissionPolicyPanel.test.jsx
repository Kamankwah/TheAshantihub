import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../../../mocks/server.js'
import CommissionPolicyPanel from '../CommissionPolicyPanel.jsx'

const API = 'http://localhost:8000'
function renderPanel(props, policies) {
  if (policies) server.use(http.get(`${API}/api/commission/policies/`, () => HttpResponse.json(policies)))
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={queryClient}><CommissionPolicyPanel {...props} /></QueryClientProvider>)
}

describe('CommissionPolicyPanel', () => {
  it('says plainly when no amount is approved, so nothing accrues', async () => {
    renderPanel({ canPropose: true })
    expect(await screen.findAllByText('No amount approved yet — nothing accrues')).toHaveLength(2)
    expect(screen.getByText('No commission has been earned yet.')).toBeInTheDocument()
  })

  it('shows the amounts in force, pending proposals and history', async () => {
    renderPanel({}, {
      current: { registration: { amount: '50.00', effective_from: '2026-01-01' }, three_paid_months_bonus: null },
      pending: [{ id: 4, kind: 'registration', amount: '55.00', effective_from: '2026-11-01', maker: 'Kofi Accounts', created_at: '2026-10-07T10:00:00Z' }],
      history: [{ kind: 'registration', kind_label: 'Registration', amount: '50.00', effective_from: '2026-01-01', proposed_by: 'Kofi Accounts', approved_by: 'Root' }],
    })
    expect(await screen.findByText('GH₵ 50.00')).toBeInTheDocument()
    expect(screen.getByText('Registration: GH₵ 55.00 from 1 Nov 2026 · proposed by Kofi Accounts')).toBeInTheDocument()
    expect(screen.getByText(/proposed by Kofi Accounts, approved by Root/)).toBeInTheDocument()
    expect(screen.queryByRole('form', { name: 'Propose a new amount' })).not.toBeInTheDocument()
  })

  it('sends a proposal for approval and says nothing changes until Super Admin approves', async () => {
    let sent = null
    server.use(http.post(`${API}/api/commission/policies/`, async ({ request }) => {
      sent = await request.json()
      return HttpResponse.json({ approval_id: 9, status: 'pending' }, { status: 201 })
    }))
    renderPanel({ canPropose: true })
    fireEvent.change(await screen.findByLabelText('Amount (GH₵)'), { target: { value: '60.00' } })
    fireEvent.change(screen.getByLabelText('Commission'), { target: { value: 'three_paid_months_bonus' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send for approval' }))
    expect(await screen.findByText(/Nothing changes until they approve it/)).toBeInTheDocument()
    expect(sent).toMatchObject({ kind: 'three_paid_months_bonus', amount: '60.00' })
  })

  it('shows the server refusal', async () => {
    server.use(http.post(`${API}/api/commission/policies/`, () => HttpResponse.json({ detail: 'A change to this amount is already waiting for approval.' }, { status: 409 })))
    renderPanel({ canPropose: true })
    fireEvent.change(await screen.findByLabelText('Amount (GH₵)'), { target: { value: '60.00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send for approval' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('already waiting for approval'))
  })

  it('lists lines with an export button', async () => {
    server.use(http.get(`${API}/api/commission/accruals/`, () => HttpResponse.json({
      count: 1, next: null, previous: null,
      results: [{ id: 1, staff: 'Kwame Asante', business: 'Adwoa Fabrics', kind_label: 'Registration', status_label: 'On hold', amount: '50.00' }],
    })))
    renderPanel({})
    expect(await screen.findByText('Kwame Asante · Adwoa Fabrics · Registration · On hold')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeInTheDocument()
  })
})
