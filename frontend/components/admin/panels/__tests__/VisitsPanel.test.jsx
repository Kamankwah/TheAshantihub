import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { server } from '../../../../mocks/server.js'
import VisitsPanel, { groupByDay } from '../VisitsPanel.jsx'

// The check-in screen has its own tests; here it is a marker.
vi.mock('../CheckInPanel.jsx', async () => {
  const { createElement } = await import('react')
  return { default: ({ presetBusinessId }) => createElement('div', null, `check-in screen ${presetBusinessId ?? 'none'}`) }
})

const API = 'http://localhost:8000'
const today = new Date()
today.setHours(11, 5, 0, 0)
const at = (daysAgo, hh, mm) => {
  const d = new Date(today)
  d.setDate(d.getDate() - daysAgo)
  d.setHours(hh, mm, 0, 0)
  return d.toISOString()
}
const visit = (id, overrides = {}) => ({
  id, status: 'done', purpose: 'prospecting', purpose_label: 'Prospecting', business: { id: id + 100, name: `Shop ${id}`, area: 'Bantama', has_pin: true },
  checked_in_at: at(0, 10, 15), checked_out_at: at(0, 10, 58), minutes: 43, distance_m: 20, outside_radius: false, radius_m: 100,
  ...overrides,
})
const page = (results, extra = {}) => ({
  count: results.length, next: null, previous: null, results,
  summary: { done: 3, avg_minutes: 24, flagged: 1 }, ...extra,
})

function renderPanel(props = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <VisitsPanel auth={{}} detailId={null} onOpenDetail={() => {}} {...props} />
    </QueryClientProvider>,
  )
}
function serveVisits(urls, build) {
  server.use(http.get(`${API}/api/field/visits/`, ({ request }) => {
    urls.push(new URL(request.url))
    return HttpResponse.json(build(new URL(request.url).searchParams))
  }))
}

describe('VisitsPanel', () => {
  it('shows the eyebrow, the three tiles and the day group with done and open counts', async () => {
    serveVisits([], () => page([
      visit(1, { status: 'open', checked_out_at: null, minutes: null, checked_in_at: at(0, 11, 5) }),
      visit(2, { business: { id: 2, name: 'Asafo Hair & Beauty', area: null, has_pin: true }, purpose_label: 'Registration' }),
      visit(3, { checked_in_at: at(1, 15, 10), checked_out_at: at(1, 15, 31), minutes: 21, outside_radius: true, distance_m: 160 }),
    ]))
    renderPanel()
    expect(await screen.findByRole('heading', { name: 'Visits' })).toBeInTheDocument()
    await screen.findByText('Asafo Hair & Beauty')
    expect(screen.getByText('Activity')).toBeInTheDocument()
    expect(screen.getByText('Average stay').nextSibling).toHaveTextContent('24 min')
    expect(screen.getByText('Flagged', { selector: 'div' }).nextSibling).toHaveTextContent('1')
    const todayGroup = screen.getByRole('region', { name: /^Today · / })
    expect(within(todayGroup).getByText('1 done · 1 open')).toBeInTheDocument()
    expect(within(todayGroup).getByText('In progress')).toBeInTheDocument()
    expect(within(todayGroup).getByText('43 min')).toBeInTheDocument()
    expect(within(todayGroup).getByText(/10:15 – 10:58/)).toBeInTheDocument()
    expect(within(todayGroup).getByText(/Registration/)).toBeInTheDocument()
    expect(screen.getByText('Outside the 100 m radius · 160 m', { exact: false })).toBeInTheDocument()
    expect(screen.getByText('1 visit')).toBeInTheDocument()
    expect(screen.getByText(/A visit counts once you check out/)).toBeInTheDocument()
  })

  it('groups consecutive visits by local day, newest first', () => {
    const groups = groupByDay([visit(1), visit(2), visit(3, { checked_in_at: at(1, 9, 0) })], today)
    expect(groups.map((g) => g.visits.length)).toEqual([2, 1])
    expect(groups[0].label).toMatch(/^Today · /)
    expect(groups[1].label).not.toMatch(/^Today/)
  })

  it('asks the server for the flagged range when Flagged is pressed', async () => {
    const urls = []
    serveVisits(urls, (params) => (params.get('range') === 'flagged'
      ? page([visit(9, { outside_radius: true, distance_m: 180 })]) : page([visit(1)])))
    renderPanel()
    await screen.findByText('Shop 1')
    expect(urls[0].searchParams.get('range')).toBe('week')
    fireEvent.click(screen.getByRole('button', { name: 'Flagged' }))
    expect(await screen.findByText('Shop 9')).toBeInTheDocument()
    expect(screen.queryByText('Shop 1')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Flagged' })).toHaveAttribute('aria-pressed', 'true')
    expect(urls.at(-1).searchParams.get('range')).toBe('flagged')
  })

  it('has a pill for the current month', async () => {
    const urls = []
    serveVisits(urls, () => page([visit(1)]))
    renderPanel()
    await screen.findByText('Shop 1')
    const month = new Date().toLocaleDateString('en-GB', { month: 'long' })
    fireEvent.click(screen.getByRole('button', { name: month }))
    await waitFor(() => expect(urls.at(-1).searchParams.get('range')).toBe('month'))
  })

  it('says so when there is nothing, and never invents an average', async () => {
    serveVisits([], () => page([], { summary: { done: 0, avg_minutes: null, flagged: 0 } }))
    renderPanel()
    expect(await screen.findByText('No visits this week yet.')).toBeInTheDocument()
    expect(screen.getByText('Average stay').nextSibling).toHaveTextContent('—')
  })

  it('offers Show N more and asks for a bigger page', async () => {
    const urls = []
    serveVisits(urls, (params) => page([visit(1), visit(2)], { count: 7 }))
    renderPanel()
    fireEvent.click(await screen.findByRole('button', { name: 'Show 5 more' }))
    await waitFor(() => expect(urls.at(-1).searchParams.get('page_size')).toBe('100'))
  })

  it('opens the check-in screen from the Check in button', async () => {
    const onOpenDetail = vi.fn()
    serveVisits([], () => page([]))
    renderPanel({ onOpenDetail })
    fireEvent.click(await screen.findByRole('button', { name: /Check in/ }))
    expect(onOpenDetail).toHaveBeenCalledWith('check-in')
  })

  it('says Open visit while a visit is open, and opens it from its row', async () => {
    const onOpenDetail = vi.fn()
    serveVisits([], () => page([visit(1, { status: 'open', checked_out_at: null, minutes: null })]))
    server.use(http.get(`${API}/api/field/visits/open/`, () => HttpResponse.json({ visit: visit(1, { status: 'open' }) })))
    renderPanel({ onOpenDetail })
    expect(await screen.findByRole('button', { name: /Open visit/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Shop 1/ }))
    expect(onOpenDetail).toHaveBeenCalledWith('check-in')
  })

  it('shows the check-in screen at the check-in route, with a pre-selected business', async () => {
    serveVisits([], () => page([]))
    renderPanel({ detailId: 'check-in-12' })
    expect(await screen.findByText('check-in screen 12')).toBeInTheDocument()
  })
})
