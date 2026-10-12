import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { server } from '../../../../mocks/server.js'
import TeamVisitMapPanel from '../TeamVisitMapPanel.jsx'

const API = 'http://localhost:8000'
const visit = (id, over = {}) => ({
  id, status: 'done', purpose: 'onboarding_photos', purpose_label: 'Onboarding & photos',
  business: { id: 40 + id, name: `Shop ${id}`, area: 'Adum', has_pin: true }, prospect: null,
  scout_name: 'Efua Mensah', checked_in_at: '2026-10-07T09:15:00Z', checked_out_at: '2026-10-07T09:50:00Z', minutes: 35,
  distance_m: 12, outside_radius: false, radius_m: 100, accuracy_m: 8, fix: { lat: 6.69, lng: -1.62 }, pin: { lat: 6.69, lng: -1.62 }, notes: '', photos: [], ...over,
})
const body = (results, over = {}) => ({
  day: '2026-10-07', is_today: true, radius_m: 100, scouts: [{ id: 1, name: 'Efua Mensah' }, { id: 2, name: 'Yaw Owusu' }],
  summary: { total: results.length, still_there: results.filter((v) => v.status === 'open').length, checked_out: results.filter((v) => v.status === 'done').length, flagged: results.filter((v) => v.outside_radius).length, team_total: results.length },
  truncated: false, results, ...over,
})
function serve(build, seen = []) {
  server.use(http.get(`${API}/api/field/visits/team/`, ({ request }) => { seen.push(Object.fromEntries(new URL(request.url).searchParams)); return HttpResponse.json(build(seen.at(-1))) }))
  return seen
}
function renderPanel(props = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}><TeamVisitMapPanel {...props} /></QueryClientProvider>)
}

describe('TeamVisitMapPanel', () => {
  it('pins each check-in with a position, marks flagged ones and lists them all', async () => {
    serve(() => body([visit(1, { status: 'open', checked_out_at: null }), visit(2, { outside_radius: true, distance_m: 180, scout_name: 'Yaw Owusu' }), visit(3, { fix: { lat: null, lng: null } })]))
    renderPanel()
    const map = await screen.findByTestId('team-visit-map')
    const pins = within(map).getAllByRole('button')
    expect(pins).toHaveLength(2)
    expect(pins.map((p) => p.dataset.state).sort()).toEqual(['flagged', 'here'])
    expect(screen.getByText(/1 check-in has no recorded position/)).toBeInTheDocument()
    expect(screen.getByText('Check-ins today · 3')).toBeInTheDocument()
    expect(screen.getByText(/180 m from the pin — outside the 100 m radius/, { selector: 'span' })).toBeInTheDocument()
    expect(screen.getByText(/not live positions/)).toBeInTheDocument()
  })

  it('sends the day, scout, purpose and flagged filters', async () => {
    const seen = serve(() => body([visit(1)]))
    renderPanel()
    await screen.findByTestId('team-visit-map')
    fireEvent.change(screen.getByLabelText('Scout'), { target: { value: '2' } })
    fireEvent.change(screen.getByLabelText('Purpose'), { target: { value: 'verification' } })
    fireEvent.click(screen.getByLabelText('Flagged only'))
    await waitFor(() => expect(seen.at(-1)).toMatchObject({ day: 'today', scout: '2', purpose: 'verification', flagged: '1' }))
  })

  it('opens a check-in from the list and from its pin, and opens its business', async () => {
    serve(() => body([visit(1, { notes: 'Owner was away' }), visit(2, { outside_radius: true, distance_m: 180 })]))
    const onOpenBusiness = vi.fn()
    renderPanel({ onOpenBusiness })
    fireEvent.click((await screen.findByText('Shop 1', { selector: 'span' })).closest('button'))
    const detail = screen.getByRole('region', { name: 'Check-in' })
    expect(detail).toHaveTextContent('Owner was away')
    expect(detail).toHaveTextContent('No photos')
    fireEvent.click(within(detail).getByRole('button', { name: 'Open the business' }))
    expect(onOpenBusiness).toHaveBeenCalledWith(41)
    fireEvent.click(within(screen.getByTestId('team-visit-map')).getAllByRole('button')[1])
    expect(screen.getByRole('region', { name: 'Check-in' })).toHaveTextContent('Shop 2')
  })

  it('says so when the team has no check-ins, and when filters match none', async () => {
    serve((q) => body([], { summary: { total: 0, still_there: 0, checked_out: 0, flagged: 0, team_total: q.flagged ? 4 : 0 } }))
    renderPanel()
    expect(await screen.findByText('Your team has no check-ins today.')).toBeInTheDocument()
    expect(screen.queryByTestId('team-visit-map')).toBeNull()
    fireEvent.click(screen.getByLabelText('Flagged only'))
    expect(await screen.findByText('No check-ins match those filters.')).toBeInTheDocument()
  })

  it('shows an error with a retry', async () => {
    server.use(http.get(`${API}/api/field/visits/team/`, () => HttpResponse.json({ detail: 'no' }, { status: 500 })))
    renderPanel()
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load the team's check-ins")
  })
})
