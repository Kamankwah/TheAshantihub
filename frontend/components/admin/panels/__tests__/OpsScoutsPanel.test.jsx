import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { server } from '../../../../mocks/server.js'
import OpsScoutsPanel from '../OpsScoutsPanel.jsx'

const API = 'http://localhost:8000'
const measures = (over = {}) => ({
  registrations: { done: 2, target: 3 }, visits: { done: 6, target: 8 }, calls: { done: 9, target: 10 }, renewals: { done: 1, target: 1 }, ...over,
})
const scout = (over = {}) => ({
  id: 1, name: 'Kwame Asante', areas: ['Asafo', 'Bantama'], manager: { id: 9, name: 'Ama Boateng' }, mine: true, state: 'working', back_on: null,
  measures: measures(), month: { done: 14, target: 81, due_by_today: 18, on_pace: false, leave_cut: 0 },
  portfolio: { size: 14, healthy: 11, needs_attention: 1, at_risk: 2, new: 0 },
  check_in: { place: "Nana's Chop Bar", at: '2026-10-07T10:52:00', outside_radius: false, distance_m: 20 },
  outside_7d: 0, fraud_case_open: false,
  report: { today: { status: 'not_yet', due: '19:00', late: false, is_late: false }, last: { date: '2026-10-06', status: 'acknowledged', is_late: false, similar: false } },
  ...over,
})
const board = (scouts, over = {}) => ({
  scope: 'team', today: '2026-10-07', month_label: 'October', now: '2026-10-07T11:46:00',
  counts: { team: scouts.filter((s) => s.mine).length, all: scouts.length },
  totals: { registrations: { done: 10, target: 13 }, visits: { done: 27, target: 32 }, calls: { done: 38, target: 40 }, renewals: { done: 3, target: 4 }, visits_flagged: 1 },
  scouts, ...over,
})

function serve(build, seen = []) {
  server.use(http.get(`${API}/api/operations/scouts/`, ({ request }) => {
    const scope = new URL(request.url).searchParams.get('scope')
    seen.push(scope)
    return HttpResponse.json(build(scope))
  }))
}
function renderPanel(props = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={queryClient}><OpsScoutsPanel auth={{ hasPermission: () => true }} {...props} /></QueryClientProvider>)
}

describe('OpsScoutsPanel', () => {
  it('shows the team totals with their sources and the row for each scout', async () => {
    serve(() => board([scout()]))
    renderPanel()
    const regs = await screen.findByRole('group', { name: 'Your team · registrations' })
    expect(regs).toHaveTextContent('10 / 13')
    expect(regs).toHaveTextContent('Counted when KYC is approved')
    expect(screen.getByRole('group', { name: 'Your team · visits' })).toHaveTextContent('Check-ins with a check-out · 1 flagged')
    expect(screen.getByRole('group', { name: 'Your team · calls' })).toHaveTextContent('From the call log')
    expect(screen.getByRole('group', { name: 'Your team · renewals' })).toHaveTextContent('Subscription payments in the app')
    const row = screen.getByText('Kwame Asante').closest('tr')
    expect(row).toHaveTextContent('Asafo · Bantama')
    expect(row).toHaveTextContent('2 / 3')
    expect(row).toHaveTextContent('6 / 8')
    expect(row).toHaveTextContent('14 / 81')
    expect(row).toHaveTextContent('18 due by today')
    expect(row).toHaveTextContent('14 businesses')
    expect(row).toHaveTextContent('11 healthy · 1 attention · 2 at risk')
    expect(row).toHaveTextContent("Nana's Chop Bar")
    expect(row).toHaveTextContent('Not yet')
    expect(row).toHaveTextContent('Tue: acknowledged')
    expect(screen.getByRole('columnheader', { name: 'October registrations' })).toBeInTheDocument()
  })

  it('says On pace when the month is on track and never invents a target', async () => {
    serve(() => board([scout({ month: { done: 20, target: 81, due_by_today: 18, on_pace: true, leave_cut: 0 } }), scout({ id: 2, name: 'New Scout', measures: measures({ calls: { done: 3, target: null } }), month: { done: 0, target: null, due_by_today: null, on_pace: null, leave_cut: 0 } })]))
    renderPanel()
    expect(await screen.findByText('On pace')).toBeInTheDocument()
    const fresh = screen.getByText('New Scout').closest('tr')
    expect(within(fresh).getAllByText('No target set').length).toBeGreaterThanOrEqual(2)
  })

  it('shows leave as dashes with the return day and what leave takes off', async () => {
    serve(() => board([scout({ id: 3, name: 'Kofi Boadu', state: 'leave', back_on: '2026-10-09', month: { done: 9, target: 69, due_by_today: 12, on_pace: false, leave_cut: 12 }, check_in: null })]))
    renderPanel()
    const row = (await screen.findByText('Kofi Boadu')).closest('tr')
    expect(row).toHaveTextContent('On leave · back Fri 9 Oct')
    expect(row).toHaveTextContent('Leave cuts 12 from the month')
    expect(within(row).getAllByLabelText('Not a working day')).toHaveLength(4)
    expect(within(row).getByText('On leave')).toBeInTheDocument()
  })

  it('flags repeated outside-radius check-ins and the fraud case', async () => {
    serve(() => board([scout({ name: 'Yaw Owusu', check_in: { place: 'Bonwire', at: '2026-10-07T09:15:00', outside_radius: true, distance_m: 180 }, outside_7d: 3, fraud_case_open: true })]))
    renderPanel()
    const row = (await screen.findByText('Yaw Owusu')).closest('tr')
    expect(row).toHaveTextContent('Bonwire · 180 m outside the business radius · 09:15')
    expect(row).toHaveTextContent('3 outside the radius in 7 days · fraud case raised')
  })

  it('shows Late and draft states for the day report', async () => {
    serve(() => board([
      scout({ report: { today: { status: 'not_yet', due: '19:00', late: true, is_late: false }, last: { date: '2026-10-06', status: 'submitted', is_late: true, similar: true } } }),
      scout({ id: 2, name: 'Efua Mensah', report: { today: { status: 'draft', due: '19:00', late: false, is_late: false }, last: null } }),
    ]))
    renderPanel()
    const a = (await screen.findByText('Kwame Asante')).closest('tr')
    expect(a).toHaveTextContent('Late')
    expect(a).toHaveTextContent('Tue: submitted, late, copy-check flag')
    expect(screen.getByText('Efua Mensah').closest('tr')).toHaveTextContent('Draft saved')
  })

  it('All scouts groups the other team read-only and says who to ask', async () => {
    const seen = []
    serve((scope) => board(scope === 'all'
      ? [scout(), scout({ id: 7, name: 'Kwaku Agyei', mine: false, manager: { id: 8, name: 'Kojo Badu' } })]
      : [scout()], { scope, counts: { team: 1, all: 2 } }), seen)
    renderPanel()
    await screen.findByText('Kwame Asante')
    expect(screen.getByRole('button', { name: /^My team · 1$/ })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: /^All scouts · 2$/ }))
    expect(await screen.findByText('Kwaku Agyei')).toBeInTheDocument()
    expect(seen).toContain('all')
    expect(screen.getByRole('rowheader', { name: /Kojo Badu's team/ })).toHaveTextContent('Read-only for you')
    expect(screen.getByRole('button', { name: 'View Kwaku Agyei' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open Kwame Asante' })).toBeInTheDocument()
    expect(screen.getByText(/Kojo Badu's scouts are read-only here; ask Kojo Badu to act on them/)).toBeInTheDocument()
    expect(screen.getByText(/nobody types them/)).toBeInTheDocument()
  })

  it('Open and Invite hand over to the shell', async () => {
    const onOpenScout = vi.fn(); const onNavigate = vi.fn()
    serve(() => board([scout()]))
    renderPanel({ onOpenScout, onNavigate })
    fireEvent.click(await screen.findByRole('button', { name: 'Open Kwame Asante' }))
    expect(onOpenScout).toHaveBeenCalledWith(1)
    fireEvent.click(screen.getByRole('button', { name: 'Invite a scout' }))
    expect(onNavigate).toHaveBeenCalledWith('my-team')
  })

  it('has an honest empty state', async () => {
    serve(() => board([]))
    renderPanel()
    expect(await screen.findByText(/No scouts report to you yet/)).toBeInTheDocument()
  })
})
