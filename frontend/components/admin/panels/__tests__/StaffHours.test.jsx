import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../../../mocks/server.js'
import PortfolioPanel from '../PortfolioPanel.jsx'
import StaffHoursSection from '../StaffHoursSection.jsx'

const API = 'http://localhost:8000'
const SCOUT = {
  user: { id: 7, full_name: 'Kwame Asante', role: 'scout', account_type: 'staff' },
  hasPermission: (c) => ['businesses.manage_portfolio', 'businesses.register', 'calls.log'].includes(c),
}
const SUMMARY = { total: 2, healthy: 2, needs_attention: 0, at_risk: 0, new: 0, unassigned: 0, at_risk_week_ago: 0 }
const biz = (id, name, hasHours) => ({
  id, business_name: name, owner_name: 'Owner', login_phone: '+233244000118', zone: { id: 3, name: 'Bantama' },
  kyc_status: 'pending', registration_channel: 'scout', needs_claim: true, claimed_at: null, has_hours: hasHours,
  account_manager: { id: 7, full_name: 'Kwame Asante' }, health: { rating: 'new', reasons: ['KYC waiting'] },
  subscription: { state: 'none' }, listings_live: 0, listings_total: 0, listings_waiting: 0, last_order_at: null,
  last_contact: null, open_fraud_flags: 0,
})
const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } })
const WEEK = Array.from({ length: 7 }, (_, d) => ({ weekday: d, closed: d === 6, opens: d === 6 ? null : '08:00', closes: d === 6 ? null : '18:00' }))

describe('staff opening hours', () => {
  it('staff editor saves hours and shows the saved week', async () => {
    let sent = null
    server.use(http.put(`${API}/api/portfolio/businesses/12/hours/`, async ({ request }) => {
      sent = await request.json()
      return HttpResponse.json({ days: sent.days, has_hours: true })
    }))
    render(<QueryClientProvider client={client()}><StaffHoursSection businessId={12} days={[]} canEdit /></QueryClientProvider>)
    expect(screen.getByText('Hours not set')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Enter opening hours' }))
    for (let d = 0; d < 6; d += 1) {
      const day = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d]
      fireEvent.change(screen.getByLabelText(`${day} opens`), { target: { value: '08:00' } })
      fireEvent.change(screen.getByLabelText(`${day} closes`), { target: { value: '18:00' } })
    }
    fireEvent.click(screen.getByLabelText('Sunday closed'))
    fireEvent.click(screen.getByRole('button', { name: 'Save opening hours' }))
    expect(await screen.findByText('Mon-Sat 08:00-18:00, Sun closed')).toBeInTheDocument()
    expect(screen.queryByText('Hours not set')).not.toBeInTheDocument()
    expect(sent.days).toHaveLength(7)
    expect(sent.days[6]).toEqual({ weekday: 6, closed: true, opens: null, closes: null })
  })

  it('shows the server message naming the failing day and keeps the editor open', async () => {
    server.use(http.put(`${API}/api/portfolio/businesses/12/hours/`, () => HttpResponse.json({ detail: 'Wednesday: Opening time must be before closing time on the same day.', weekday: 2 }, { status: 400 })))
    render(<QueryClientProvider client={client()}><StaffHoursSection businessId={12} days={WEEK} canEdit /></QueryClientProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Edit opening hours' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save opening hours' }))
    expect(await screen.findByText(/^Wednesday: Opening time must be before/)).toBeInTheDocument()
    expect(screen.getByRole('form', { name: 'Weekly opening hours' })).toBeInTheDocument()
  })

  it('offers no editor to someone who cannot edit', () => {
    render(<QueryClientProvider client={client()}><StaffHoursSection businessId={12} days={[]} canEdit={false} /></QueryClientProvider>)
    expect(screen.queryByRole('button', { name: /opening hours/ })).not.toBeInTheDocument()
  })

  it('badge and filter list hourless businesses', async () => {
    const seen = []
    server.use(http.get(`${API}/api/portfolio/businesses/`, ({ request }) => {
      const flag = new URL(request.url).searchParams.get('flag')
      seen.push(flag)
      const rows = [biz(1, 'No Hours Shop', false), biz(2, 'Hours Shop', true)]
      return HttpResponse.json({ count: 2, next: null, previous: null, results: flag === 'no_hours' ? [rows[0]] : rows, summary: SUMMARY })
    }))
    render(<QueryClientProvider client={client()}><PortfolioPanel mode="mine" auth={SCOUT} /></QueryClientProvider>)
    const noHours = await screen.findByRole('article', { name: 'No Hours Shop' })
    expect(within(noHours).getByText('Hours not set')).toBeInTheDocument()
    expect(within(screen.getByRole('article', { name: 'Hours Shop' })).queryByText('Hours not set')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Hours not set' }))
    await waitFor(() => expect(screen.queryByRole('article', { name: 'Hours Shop' })).not.toBeInTheDocument())
    expect(seen).toContain('no_hours')
  })
})
