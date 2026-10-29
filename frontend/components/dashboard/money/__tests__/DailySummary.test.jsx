import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../../../mocks/server.js'
import DailySummary from '../DailySummary.jsx'

const API = 'http://localhost:8000'
const wrap = (ui) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}
const day = (over = {}) => ({
  day: '2026-10-14', orders: 3, sold: '300.00', fees: '15.00', released: '120.00', refunded: '10.00',
  free_delivery_promo: '2.00', withdrawn: '50.00', other: '0.00', net_change: '223.00', ...over,
})
const body = (over = {}) => ({
  from: '2026-10-01', to: '2026-10-20',
  days: [day(), day({ day: '2026-10-12', orders: 1, sold: '100.00', net_change: '-40.50', other: '-5.00' })],
  totals: day({ day: undefined, orders: 4, sold: '400.00', net_change: '182.50' }),
  ...over,
})
const serve = (payload, seen) => server.use(http.get(`${API}/api/wallet/vendor/daily/`, ({ request }) => {
  seen?.push(new URL(request.url).searchParams)
  return HttpResponse.json(payload)
}))

describe('DailySummary', () => {
  it('test_daily_rows_and_totals_render_as_sent', async () => {
    serve(body())
    wrap(<DailySummary />)
    expect(await screen.findByText('2026-10-01 to 2026-10-20')).toBeInTheDocument()
    for (const h of ['Day', 'Sales paid', 'Sold', 'Platform fees', 'Released', 'Refunded', 'Free-delivery promo', 'Withdrawn', 'Other', 'Change']) {
      expect(screen.getByRole('columnheader', { name: h })).toBeInTheDocument()
    }
    const rows = screen.getAllByRole('row')
    expect(rows).toHaveLength(4) // header, two days, totals
    expect(within(rows[1]).getByText('2026-10-14')).toBeInTheDocument()
    expect(within(rows[1]).getByText('3')).toBeInTheDocument()
    expect(within(rows[1]).getByText('GH₵ 300.00').closest('[data-amount]')).not.toBeNull()
    expect(within(rows[3]).getByText('GH₵ 400.00')).toBeInTheDocument()
    expect(within(rows[3]).getByText('Total')).toBeInTheDocument()
    expect(screen.getByText('Days when nothing moved are left out.')).toBeInTheDocument()
    expect(screen.getByText('Sold − platform fees − refunded − free-delivery promo − withdrawn + other = the change in your Pending and Available.')).toBeInTheDocument()
  })

  it('test_other_column_is_always_shown', async () => {
    serve(body())
    wrap(<DailySummary />)
    await screen.findByRole('columnheader', { name: 'Other' })
    const first = screen.getAllByRole('row')[1]
    expect(within(first).getAllByText('GH₵ 0.00').length).toBeGreaterThan(0)
  })

  it('test_negative_change_has_a_minus_sign', async () => {
    serve(body())
    wrap(<DailySummary />)
    expect(await screen.findByText('−GH₵ 40.50')).toBeInTheDocument()
    expect(screen.getByText('−GH₵ 5.00')).toBeInTheDocument()
  })

  it('test_blank_dates_send_no_params_and_typed_dates_are_sent', async () => {
    const seen = []
    serve(body(), seen)
    wrap(<DailySummary />)
    await screen.findByText('2026-10-01 to 2026-10-20')
    expect(seen[0].get('date_from')).toBeNull()
    expect(seen[0].get('date_to')).toBeNull()
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-10-05' } })
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-10-10' } })
    await waitFor(() => {
      const last = seen[seen.length - 1]
      expect([last.get('date_from'), last.get('date_to')]).toEqual(['2026-10-05', '2026-10-10'])
    })
  })

  it('test_review_focus_a_too_long_range_shows_the_servers_message', async () => {
    server.use(http.get(`${API}/api/wallet/vendor/daily/`, () => HttpResponse.json({ date_from: 'Choose at most 92 days.' }, { status: 400 })))
    wrap(<DailySummary />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Choose at most 92 days.')
    expect(screen.getByLabelText('From')).toBeInTheDocument()
  })

  it('test_empty_range_says_nothing_moved', async () => {
    serve(body({ days: [] }))
    wrap(<DailySummary />)
    expect(await screen.findByText('Nothing moved in this range.')).toBeInTheDocument()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('test_table_scrolls_inside_its_card', async () => {
    serve(body())
    wrap(<DailySummary />)
    const table = await screen.findByRole('table')
    expect(table.parentElement.style.overflowX).toBe('auto')
  })
})
