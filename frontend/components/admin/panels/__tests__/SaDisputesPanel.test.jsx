import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../../../mocks/server.js'
import SaDisputesPanel from '../SaDisputesPanel.jsx'
import { API, SA, page, param, renderPanel } from './saTestUtils.jsx'

const d = (over) => ({
  id: 9, order: 41, order_total_amount: '45.00', raised_by_name: 'Yaa Boatemaa', reason: 'delivery_issue', reason_label: 'Delivery Issue', description: 'Never came', status: 'open',
  flagged_by_name: null, resolved_by_name: null, refund_amount: null, created_at: '2026-10-07T10:00:00Z', updated_at: '2026-10-07T10:00:00Z',
  team: 'support', team_label: 'Support', stage: 'Intake', businesses: ['Nana\'s Chop Bar'], at_stake: '45.00', ...over,
})
const ROWS = [d(), d({ id: 10, order: 42, status: 'investigating', team: 'accounting', team_label: 'Accounting', stage: 'Decision', flagged_by_name: 'Esi Nyarko', reason_label: 'Quality Issue', at_stake: '100.00', order_total_amount: '100.00' })]
const COUNTS = { open: 2, opened_today: 1, with_support: 1, with_accounting: 1, closed_this_month: 4, order_value_at_stake: '145.00' }

function setup() {
  const seen = { urls: [], flags: [] }
  server.use(
    http.get(`${API}/api/marketplace/disputes/`, ({ request }) => { seen.urls.push(request.url); return HttpResponse.json(page(ROWS)) }),
    http.get(`${API}/api/marketplace/disputes/counts/`, () => HttpResponse.json(COUNTS)),
    http.post(`${API}/api/disputes/:id/flag/`, ({ params }) => { seen.flags.push(params.id); return HttpResponse.json({ id: 9 }) }),
  )
  return seen
}

describe('SaDisputesPanel', () => {
  it('derives the team and stage from the dispute status only and invents no timers', async () => {
    setup()
    renderPanel(<SaDisputesPanel auth={SA} />)
    const table = await screen.findByRole('table', { name: 'Cases' })
    const headers = within(table).getAllByRole('columnheader').map((h) => h.textContent)
    expect(headers).not.toContain('Answer due')
    const open = within(table).getByText('#9').closest('tr')
    expect(within(open).getByText('Support')).toBeInTheDocument()
    expect(within(open).getByText('Intake')).toBeInTheDocument()
    const inv = within(table).getByText('#10').closest('tr')
    expect(within(inv).getByText('Accounting')).toBeInTheDocument()
    expect(within(inv).getByText('Flagged by Esi Nyarko')).toBeInTheDocument()
  })

  it('draws only the three stages the records support', async () => {
    setup()
    renderPanel(<SaDisputesPanel auth={SA} />)
    const stages = await screen.findByRole('region', { name: 'How a case moves' })
    expect(within(stages).getByText('1 · Intake')).toBeInTheDocument()
    expect(within(stages).getByText('2 · Decision')).toBeInTheDocument()
    expect(within(stages).getByText('3 · Closed')).toBeInTheDocument()
    expect(within(stages).queryByText(/Evidence/)).not.toBeInTheDocument()
  })

  it('shows the counts and passes the filters', async () => {
    const seen = setup()
    renderPanel(<SaDisputesPanel auth={SA} />)
    const strip = await screen.findByRole('group', { name: 'Disputes summary' })
    await waitFor(() => expect(within(strip).getByText('GH₵ 145.00')).toBeInTheDocument())
    expect(within(strip).getByText('1 opened today')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('With'), { target: { value: 'accounting' } })
    await waitFor(() => expect(seen.urls.some((u) => param(u, 'team') === 'accounting' && param(u, 'scope') === 'open')).toBe(true))
    fireEvent.change(screen.getByLabelText('Which cases'), { target: { value: 'closed' } })
    await waitFor(() => expect(seen.urls.some((u) => param(u, 'scope') === 'closed')).toBe(true))
  })

  it('opens a case with its description and the Disputes queue actions', async () => {
    const seen = setup()
    renderPanel(<SaDisputesPanel auth={SA} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Open case 9' }))
    const side = await screen.findByRole('region', { name: 'Case 9' })
    expect(within(side).getByText(/Never came/)).toBeInTheDocument()
    fireEvent.click(within(side).getByRole('button', { name: /Flag/ }))
    await waitFor(() => expect(seen.flags).toEqual(['9']))
  })
})
