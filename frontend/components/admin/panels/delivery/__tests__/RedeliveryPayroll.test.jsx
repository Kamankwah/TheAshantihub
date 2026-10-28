import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../../../../mocks/server.js'
import { PayoutsPanel } from '../CashPanel.jsx'
import { EarningsScreen } from '../../rider/RiderScreens.jsx'

const API = 'http://localhost:8000'
const wrap = (ui) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>)

const payouts = (over = {}) => ({
  since: '2026-10-07T00:00:00Z', weeks: 2, card: null,
  riders: [{ staff_id: 4, full_name: 'Kofi Appiah', jobs: 1, jobs_with_pay: 1, earned: '12.00' }],
  payout: { status: 'not_connected', note: 'Payout runs arrive with the Accounting phase.' }, ...over,
})
const trip = { id: 9, order: 31, attempt: 1, completed_at: '2026-10-20T10:00:00Z', fee: '15.00' }

describe('Re-delivery fees owed through payroll', () => {
  it('lists re-delivery fees owed as a separate payroll section', async () => {
    server.use(http.get(`${API}/api/delivery/payouts/`, () => HttpResponse.json(payouts({ redeliveries: [{ staff_id: 4, full_name: 'Kofi Appiah', trips: 2, owed: '30.00' }] }))))
    wrap(<PayoutsPanel />)
    const section = await screen.findByRole('region', { name: 'Re-delivery trips owed through payroll' })
    expect(within(section).getByText(/paid through payroll, not from this screen/)).toBeInTheDocument()
    expect(within(section).getByText('Kofi Appiah')).toBeInTheDocument()
    expect(within(section).getByText('GH₵ 30.00')).toBeInTheDocument()
    expect(within(section).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Rider', 'Trips', 'Owed'])
    expect(within(section).queryByRole('button')).not.toBeInTheDocument()
  })

  it("shows each trip under the rider's lines", async () => {
    server.use(
      http.get(`${API}/api/delivery/payouts/`, () => HttpResponse.json(payouts())),
      http.get(`${API}/api/delivery/payouts/4/`, () => HttpResponse.json({ results: [], redeliveries: [trip] })),
    )
    wrap(<PayoutsPanel />)
    fireEvent.click(await screen.findByRole('button', { name: 'Kofi Appiah' }))
    expect(await screen.findByText('Re-delivery trips')).toBeInTheDocument()
    expect(screen.getByText('#31')).toBeInTheDocument()
    expect(screen.getByText('GH₵ 15.00')).toBeInTheDocument()
  })

  it('the rider sees their re-delivery trips', async () => {
    server.use(http.get(`${API}/api/delivery/rider/earnings/`, () => HttpResponse.json({
      period: 'today', since: '2026-10-20', jobs: 0, jobs_without_pay: 0, could_not_deliver: 0, total: null, results: [], rates: null,
      rate_change_pending: false, payouts: { status: 'not_connected', note: 'Payouts are prepared by Accounting.' }, redeliveries: [trip],
    })))
    wrap(<EarningsScreen />)
    const section = await screen.findByRole('region', { name: 'Re-delivery trips' })
    expect(within(section).getByText('Each re-delivery fee is owed to you and paid through payroll.')).toBeInTheDocument()
    expect(within(section).getByText('GH₵ 15.00')).toBeInTheDocument()
    expect(within(section).getByText(/Order #31/)).toBeInTheDocument()
  })

  it('no section when none', async () => {
    server.use(
      http.get(`${API}/api/delivery/payouts/`, () => HttpResponse.json(payouts({ redeliveries: [] }))),
      http.get(`${API}/api/delivery/rider/earnings/`, () => HttpResponse.json({
        period: 'today', since: '2026-10-20', jobs: 0, jobs_without_pay: 0, could_not_deliver: 0, total: null, results: [], rates: null,
        rate_change_pending: false, payouts: { status: 'not_connected', note: 'x' }, redeliveries: [],
      })),
    )
    const first = wrap(<PayoutsPanel />)
    await screen.findByText('What each rider earned')
    expect(screen.queryByText(/Re-delivery trips/)).not.toBeInTheDocument()
    first.unmount()
    wrap(<EarningsScreen />)
    await screen.findByText('Payouts')
    expect(screen.queryByText(/Re-delivery trips/)).not.toBeInTheDocument()
  })
})
