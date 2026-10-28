import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../../../mocks/server.js'
import ApprovalsPanel from '../ApprovalsPanel.jsx'

// Plan 3F self-review, 7C Task 5: staff cannot edit payout details from any
// screen, so the holder-details request is never made here; when 7C creates one
// (and a stuck-withdrawal resolution) it must appear in Approvals by kind_label.
// Kind keys and labels are those registered in backend/wallets/approval_kinds.py
// and backend/wallets/holder_details.py.
const request = (id, kind, kind_label, title) => ({
  id, kind, kind_label, title, status: 'pending', stage: 'manager',
  maker: { id: 3, full_name: 'Kwame Asante', role: 'accountant' }, assigned_to: null, pool_permission: 'wallets.manage',
  target: { type: 'wallets.withdrawal', id: String(id), label: title }, maker_note: '', decided_by: null, decided_at: null,
  decision_note: '', due_at: new Date(Date.now() + 3600 * 1000).toISOString(), escalation_level: 0,
  created_at: new Date().toISOString(), can_decide: true, can_cancel: false,
})

describe('Approvals inbox lists wallet requests', () => {
  it('shows a stuck-withdrawal resolution and a holder-details edit by their kind_label', async () => {
    server.use(http.get('http://localhost:8000/api/approvals/', () => HttpResponse.json({
      count: 2, next: null, previous: null,
      results: [
        request(11, 'wallets.withdrawal_resolution', 'Resolve a stuck withdrawal', 'WD-0005'),
        request(12, 'wallets.holder_details_edit', "Change a holder's payout name or contact", 'Ama Mensah'),
      ],
    })))
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ApprovalsPanel detailId={null} onOpenDetail={() => {}} />
      </QueryClientProvider>,
    )
    expect(await screen.findByText('Resolve a stuck withdrawal')).toBeInTheDocument()
    expect(screen.getByText("Change a holder's payout name or contact")).toBeInTheDocument()
  })
})
