import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../../../mocks/server.js'
import FraudAlertsPanel from '../FraudAlertsPanel.jsx'

const API = 'http://localhost:8000'
const flag = (id, over = {}) => ({ id, kind: 'outside_radius', kind_label: 'Check-ins outside the radius', status: 'open', source: 'system', title: `Case ${id}`, detail: '', evidence: [], business_owner: null, related_business_owner: null, staff_subject: null, raised_by_name: null, created_at: '2026-10-08T08:46:00Z', resolved_by_name: null, resolved_at: null, resolution_note: '', can_suspend: false, ...over })
const AUTH = { user: { id: 1, full_name: 'Simon', role: 'super_admin' }, hasPermission: () => true }

describe('FraudAlertsPanel', () => {
  it('puts cases that name a staff member first and lists unmonitored anomalies without zeros', async () => {
    server.use(
      http.get(`${API}/api/fraud/flags/`, () => HttpResponse.json({ count: 2, next: null, previous: null, results: [flag(1), flag(2, { staff_subject: { id: 5, full_name: 'Yaw Owusu' } })] })),
      http.get(`${API}/api/fraud/flags/counts/`, () => HttpResponse.json({ open: 2, confirmed: 1, dismissed: 0 })),
    )
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><FraudAlertsPanel auth={AUTH} /></QueryClientProvider>)
    const needs = await screen.findByRole('region', { name: 'Needs you' })
    expect(needs).toHaveTextContent('Case 2')
    expect(needs).toHaveTextContent('About Yaw Owusu')
    expect(needs).not.toHaveTextContent('Case 1')
    const anomalies = screen.getByRole('region', { name: 'Money and activity anomalies' })
    expect(anomalies).toHaveTextContent('Rider cash not handed in')
    expect(anomalies.textContent.match(/Not monitored yet/g).length).toBeGreaterThanOrEqual(5)
    expect(anomalies).not.toHaveTextContent(/\b0 open\b/)
  })

  it('shows no Needs you block when no open case names a staff member', async () => {
    server.use(
      http.get(`${API}/api/fraud/flags/`, () => HttpResponse.json({ count: 1, next: null, previous: null, results: [flag(1)] })),
      http.get(`${API}/api/fraud/flags/counts/`, () => HttpResponse.json({ open: 1, confirmed: 0, dismissed: 0 })),
    )
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><FraudAlertsPanel auth={AUTH} /></QueryClientProvider>)
    await screen.findByText('Case 1', { selector: 'h3' })
    expect(screen.queryByRole('region', { name: 'Needs you' })).not.toBeInTheDocument()
  })
})
