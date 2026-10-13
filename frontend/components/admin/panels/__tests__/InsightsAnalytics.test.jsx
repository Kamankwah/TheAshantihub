import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../../../mocks/server.js'
import GrowthFunnelPanel from '../GrowthFunnelPanel.jsx'
import SaAnalyticsPanel from '../SaAnalyticsPanel.jsx'

const API = 'http://localhost:8000'
const wrap = (ui) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>)

const analytics = (over = {}) => ({
  simulated: true,
  kpis: { businesses: 12, customers: 40, customers_ordered_90: 9, orders: 3, gmv: '170.00', repeat_rate: 50.0, repeaters: 1, buyers: 2, listings_live: 30, categories_live: 6 },
  months: [
    { month: '2026-09', label: 'Sep 2026', partial: false, days: 30, businesses: 10, customers: 5, orders: 0, gmv: '0.00', repeat_rate: null },
    { month: '2026-10', label: 'Oct 2026', partial: true, days: 7, businesses: 12, customers: 4, orders: 3, gmv: '170.00', repeat_rate: 50.0 },
  ],
  zones: [{ zone_id: 1, zone: 'Manhyia', businesses: 4, buyers: 2, orders: 3, gmv: '170.00', repeat_rate: null }],
  not_measured: [{ name: 'Site visits and conversion', why: 'No web analytics tool is connected.' }, { name: 'Customer satisfaction', why: 'Arrives with the support desk.' }],
  zone_options: [{ id: 1, name: 'Manhyia' }],
  ...over,
})

describe('SaAnalyticsPanel', () => {
  it('shows counted figures, no rate where there is nothing to divide, and the not-measured block', async () => {
    server.use(http.get(`${API}/api/insights/analytics/`, () => HttpResponse.json(analytics())))
    wrap(<SaAnalyticsPanel />)
    expect(await screen.findByRole('group', { name: 'GMV' })).toHaveTextContent('GH₵ 170.00')
    expect(screen.getByRole('group', { name: 'Repeat rate' })).toHaveTextContent('1 of 2 bought more than once')
    const sep = screen.getByText('Sep 2026').closest('tr')
    expect(within(sep).getByText('Not enough data')).toBeInTheDocument()
    expect(screen.getByText(/Oct 2026/)).toBeInTheDocument()
    expect(screen.getByText(/7 days so far/)).toBeInTheDocument()
    const missing = screen.getByRole('region', { name: 'Not measured yet' })
    expect(within(missing).getByText('Site visits and conversion')).toBeInTheDocument()
    expect(screen.getByText(/Payments are simulated/)).toBeInTheDocument()
  })

  it('asks the server for one zone', async () => {
    const seen = []
    server.use(http.get(`${API}/api/insights/analytics/`, ({ request }) => { seen.push(new URL(request.url).searchParams.get('zone')); return HttpResponse.json(analytics()) }))
    wrap(<SaAnalyticsPanel />)
    await screen.findByRole('group', { name: 'GMV' })
    fireEvent.change(screen.getByLabelText('Zone'), { target: { value: '1' } })
    await waitFor(() => expect(seen).toContain('1'))
  })
})

describe('GrowthFunnelPanel', () => {
  const stage = (key, label, count, extra = {}) => ({ key, label, note: label, count, share_of_visited: null, share_of_previous: null, median_days: null, ...extra })
  const funnel = (over = {}) => ({
    from: '2026-04-15', to: '2026-10-13', team: null, scouts: 2, overall: 25.0,
    stages: [stage('visited', 'Scout visited', 4), stage('registered', 'Registered', 3, { share_of_previous: 75.0, median_days: 3 }), stage('kyc', 'KYC approved', 2, { share_of_previous: 66.7 }), stage('listing', 'First listing live', 2), stage('order', 'First paid sale', 1), stage('paid3', '3 months paid', 1, { share_of_previous: 100.0 })],
    by_scout: [{ staff_id: 1, name: 'Kwame Asante', counts: { visited: 4, registered: 3, kyc: 2, listing: 2, order: 1, paid3: 1 }, kyc_share: 66.7, overall: 25.0, below_team: true }],
    by_zone: [{ zone_id: 1, zone: 'Manhyia', counts: { visited: 4, registered: 3, kyc: 2, listing: 2, order: 1, paid3: 1 } }],
    team_options: [{ id: 5, name: "Ama Boateng's scouts" }],
    notes: [{ title: 'Scout visited to Registered: 1 didn’t continue', body: 'The largest drop by count.' }],
    ...over,
  })

  it('shows the cohort stage by stage with generated, count-based drop-off notes', async () => {
    server.use(http.get(`${API}/api/insights/funnel/`, () => HttpResponse.json(funnel())))
    wrap(<GrowthFunnelPanel />)
    expect(await screen.findByText('Visit to 3 months paid: 25.0%')).toBeInTheDocument()
    expect(screen.getByText(/75% of the stage before · median 3 days/)).toBeInTheDocument()
    expect(screen.getByText('Kwame Asante')).toBeInTheDocument()
    expect(screen.getByText('Where businesses drop out')).toBeInTheDocument()
    expect(screen.getByText(/didn’t continue/)).toBeInTheDocument()
  })

  it('says so when no scout logged a visit instead of drawing an empty funnel', async () => {
    server.use(http.get(`${API}/api/insights/funnel/`, () => HttpResponse.json(funnel({ overall: null, stages: funnel().stages.map((s) => ({ ...s, count: 0 })), by_scout: [], by_zone: [], notes: [] }))))
    wrap(<GrowthFunnelPanel />)
    expect(await screen.findByText(/No scout logged a done visit to a new place/)).toBeInTheDocument()
    expect(screen.queryByText(/Visit to 3 months paid/)).not.toBeInTheDocument()
  })

  it('narrows to one team through the server', async () => {
    const seen = []
    server.use(http.get(`${API}/api/insights/funnel/`, ({ request }) => { seen.push(new URL(request.url).searchParams.get('team')); return HttpResponse.json(funnel()) }))
    wrap(<GrowthFunnelPanel />)
    await screen.findByText(/Visit to 3 months paid/)
    fireEvent.change(screen.getByLabelText('Team'), { target: { value: '5' } })
    await waitFor(() => expect(seen).toContain('5'))
  })
})
