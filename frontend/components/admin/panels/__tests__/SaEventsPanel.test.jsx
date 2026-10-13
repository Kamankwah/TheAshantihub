import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../../../mocks/server.js'
import SaEventsPanel from '../SaEventsPanel.jsx'
import { API, page, param, renderPanel } from './saTestUtils.jsx'

const ev = (over) => ({
  id: 1, name: 'Akwasidae palace visit', organiser: { kind: 'business', id: 1, name: 'Manhyia Tours', verified: true }, event_date: '2026-10-12T09:00:00Z', address: 'Manhyia', zone: 'Manhyia',
  state: 'on_sale', state_label: 'On sale', tickets_sold: 45, capacity: 50, checked_in: 0, price_min: '80.00', price_max: '80.00', sales: '3600.00', held: '3600.00', released: '0.00', refunded: '0.00', refunded_count: 0,
  ticket_types: [{ id: 1, name: 'Regular', price: '80.00', sold: 45, total: 50, active: true }], paid_at: '2026-10-01T00:00:00Z', ...over,
})
const ROWS = [
  ev(),
  ev({ id: 2, name: 'Rooftop comedy night', state: 'waiting', state_label: 'Waiting for review', tickets_sold: 0, capacity: null, sales: '0.00', held: '0.00', ticket_types: [], price_min: null, price_max: null, paid_at: null }),
  ev({ id: 3, name: 'Kente Festival day trip', state: 'ended', state_label: 'Ended', tickets_sold: 60, capacity: 60, sales: '7200.00', held: '0.00', released: '7200.00', refunded: '240.00', refunded_count: 2, checked_in: 57 }),
]
const COUNTS = { on_sale: 1, next_event_at: '2026-10-12T09:00:00Z', tickets_sold: 45, capacity: 50, held: '3600.00', released_this_month: '7200.00', refunded_this_quarter: '240.00', waiting_for_review: 1 }

function setup() {
  const urls = []
  server.use(
    http.get(`${API}/api/marketplace/events/`, ({ request }) => { urls.push(request.url); return HttpResponse.json(page(ROWS)) }),
    http.get(`${API}/api/marketplace/events/counts/`, () => HttpResponse.json(COUNTS)),
  )
  return urls
}

describe('SaEventsPanel', () => {
  it('shows money split by the tickets own escrow state, and says nothing is paid out', async () => {
    setup()
    renderPanel(<SaEventsPanel />)
    const table = await screen.findByRole('table', { name: 'Events' })
    const trip = within(table).getByText('Kente Festival day trip').closest('tr')
    expect(within(trip).getByText('Released GH₵ 7,200.00')).toBeInTheDocument()
    expect(within(trip).getByText('Refunded GH₵ 240.00')).toBeInTheDocument()
    expect(within(table).getByText('Rooftop comedy night').closest('tr')).toHaveTextContent('Nothing collected')
    expect(screen.getByText(/nothing is paid out for real yet/)).toBeInTheDocument()
    expect(screen.getByText(/Paying organisers out is not built yet/)).toBeInTheDocument()
  })

  it('draws seats and the progress bar only when there is a capacity', async () => {
    setup()
    renderPanel(<SaEventsPanel />)
    const table = await screen.findByRole('table', { name: 'Events' })
    const visit = within(table).getByText('Akwasidae palace visit').closest('tr')
    expect(within(visit).getByText('45 of 50')).toBeInTheDocument()
    expect(within(visit).getByRole('progressbar', { name: 'Tickets sold' })).toHaveAttribute('aria-valuenow', '45')
    expect(within(within(table).getByText('Rooftop comedy night').closest('tr')).queryByRole('progressbar')).not.toBeInTheDocument()
  })

  it('shows the header counts', async () => {
    setup()
    renderPanel(<SaEventsPanel />)
    const strip = await screen.findByRole('group', { name: 'Events summary' })
    await waitFor(() => expect(within(strip).getByText('45 / 50')).toBeInTheDocument())
    expect(within(strip).getByText('1 event')).toBeInTheDocument()
    expect(within(strip).getByText('GH₵ 3,600.00')).toBeInTheDocument()
  })

  it('filters and opens an event', async () => {
    const urls = setup()
    renderPanel(<SaEventsPanel />)
    fireEvent.change(await screen.findByLabelText('Show'), { target: { value: 'ended' } })
    await waitFor(() => expect(urls.some((u) => param(u, 'show') === 'ended')).toBe(true))
    fireEvent.click(screen.getByRole('button', { name: 'Open Akwasidae palace visit' }))
    const side = await screen.findByRole('region', { name: 'Akwasidae palace visit' })
    expect(within(side).getByText(/Manhyia Tours · verified business/)).toBeInTheDocument()
    expect(within(side).getByText(/Regular GH₵ 80.00 · 45 of 50 sold/)).toBeInTheDocument()
  })
})
