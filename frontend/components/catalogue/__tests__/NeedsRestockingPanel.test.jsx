import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../../mocks/server.js'
import NeedsRestockingPanel from '../NeedsRestockingPanel.jsx'
import { STOCK_COUNT_HELP } from '../catalogueFormat.js'

const API = 'http://localhost:8000'
const S = { cover_days: 7, fallback_units: 5, window_days: 28, alerts_enabled: false, sold_out_hidden: false }
const row = (o) => ({ listing_id: 1, name: 'Rice', stock: 2, units_sold: 14, days_on_sale: 14, days_of_cover: '2.0', basis: 'sales', line: null, low: true, sold_out: false, ...o })
const page = (results, o = {}) => ({ count: results.length, next: null, previous: null, results, tracked_offers: 3, untracked_offers: 0, settings: S, ...o })

function setup(body, { listings = [], restock } = {}) {
  const posts = []
  server.use(
    http.get(`${API}/api/catalogue/stock/`, ({ request }) => {
      const p = new URL(request.url).searchParams.get('page')
      return HttpResponse.json(typeof body === 'function' ? body(p) : body)
    }),
    http.get(`${API}/api/listings/mine/`, () => HttpResponse.json(listings)),
    http.post(`${API}/api/listings/mine/:id/restock/`, async ({ request, params }) => {
      posts.push({ id: params.id, body: await request.json() })
      return restock ? restock() : HttpResponse.json({ ok: true })
    }),
  )
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><NeedsRestockingPanel /></QueryClientProvider>)
  return posts
}

describe('NeedsRestockingPanel', () => {
  it('test_sold_out_rows_come_first_as_the_server_sends_them', async () => {
    setup(page([row({ listing_id: 2, name: 'Zinc', stock: 0, sold_out: true }), row({ listing_id: 1, name: 'Apple' })]))
    await screen.findByText('Zinc')
    const names = screen.getAllByRole('listitem').map((li) => li.textContent)
    expect(names[0]).toContain('Zinc')
    expect(names[1]).toContain('Apple')
  })

  it('test_each_row_explains_its_basis_in_plain_words', async () => {
    setup(page([
      row({ listing_id: 1, name: 'A' }),
      row({ listing_id: 2, name: 'B', basis: 'fallback', units_sold: 0, days_of_cover: null, stock: 3, line: 5 }),
      row({ listing_id: 3, name: 'C', basis: 'own_threshold', stock: 4, line: 6 }),
    ]))
    expect(await screen.findByText('About 2.0 days of sales left: 14 sold in the last 14 day(s).')).toBeInTheDocument()
    expect(screen.getByText('3 left. No sales in the last 28 days, so it counts as low at 5 or fewer.')).toBeInTheDocument()
    expect(screen.getByText('4 left. Your alert line is 6.')).toBeInTheDocument()
  })

  it('test_sold_out_and_low_chips_carry_text_not_colour_alone', async () => {
    setup(page([row({ listing_id: 2, name: 'Zinc', stock: 0, sold_out: true }), row({ listing_id: 1, name: 'Apple' })]))
    await screen.findByText('Zinc')
    expect(screen.getByText('Sold out')).toBeInTheDocument()
    expect(screen.getByText('Low stock')).toBeInTheDocument()
  })

  it('test_counts_line_says_how_many_are_not_counted', async () => {
    setup(page([], { tracked_offers: 3, untracked_offers: 2 }))
    expect(await screen.findByText(/3 of your products have a stock count\./)).toBeInTheDocument()
    expect(screen.getByText(/2 don't, so we can't tell when they run low\./)).toBeInTheDocument()
    expect(screen.getByText(/fewer than 7 days of sales are left, or, with no sales in 28 days, at 5 or fewer/)).toBeInTheDocument()
  })

  it('test_empty_state_says_nothing_needs_restocking', async () => {
    setup(page([]))
    expect(await screen.findByText('Nothing needs restocking right now.')).toBeInTheDocument()
  })

  it('test_load_more_follows_next', async () => {
    setup((p) => p === '2'
      ? { ...page([row({ listing_id: 2, name: 'Second' })], { count: 2 }) }
      : { ...page([row({ listing_id: 1, name: 'First' })], { count: 2, next: `${API}/api/catalogue/stock/?page=2` }) })
    await screen.findByText('First')
    expect(screen.getByText('Showing 1 of 2')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
    expect(await screen.findByText('Second')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull()
  })

  it('test_restock_posts_add_and_refreshes_the_list', async () => {
    let calls = 0
    const posts = setup(() => { calls += 1; return page([row()]) })
    await screen.findByText('Rice')
    fireEvent.change(screen.getByLabelText('Units to add to Rice'), { target: { value: '10' } })
    fireEvent.click(screen.getByRole('button', { name: 'Restock' }))
    await waitFor(() => expect(calls).toBeGreaterThan(1))
    expect(posts).toEqual([{ id: '1', body: { add: 10 } }])
  })

  it('test_restock_refusal_shows_the_server_detail', async () => {
    setup(page([row()]), { restock: () => HttpResponse.json({ detail: 'Stock cannot go above the limit.' }, { status: 400 }) })
    await screen.findByText('Rice')
    fireEvent.change(screen.getByLabelText('Units to add to Rice'), { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Restock' }))
    expect(await screen.findByText('Stock cannot go above the limit.')).toBeInTheDocument()
  })

  it('test_restock_blocks_a_non_positive_or_non_whole_number_and_sends_nothing', async () => {
    const posts = setup(page([row()]))
    await screen.findByText('Rice')
    const box = screen.getByLabelText('Units to add to Rice')
    for (const bad of ['', '0', '-3', '2.5']) {
      fireEvent.change(box, { target: { value: bad } })
      fireEvent.click(screen.getByRole('button', { name: 'Restock' }))
      expect(await screen.findByText('Enter a whole number of units, 1 or more.')).toBeInTheDocument()
      fireEvent.change(box, { target: { value: '' } })
    }
    expect(posts).toEqual([])
  })

  it('test_a_variant_listing_gets_the_per_option_note_not_a_restock_box', async () => {
    setup(page([row({ listing_id: 1, name: 'Shirt' }), row({ listing_id: 2, name: 'Rice' })]), { listings: [{ id: 1, has_variants: true }, { id: 2, has_variants: false }] })
    expect(await screen.findByText('Restock each option on its card under Your products.')).toBeInTheDocument()
    expect(screen.queryByLabelText('Units to add to Shirt')).toBeNull()
    expect(screen.getByLabelText('Units to add to Rice')).toBeInTheDocument()
    const items = screen.getAllByRole('listitem')
    expect(within(items[0]).getByText('Restock each option on its card under Your products.')).toBeInTheDocument()
  })

  it('test_stock_count_help_is_shown', async () => {
    setup(page([]))
    expect(await screen.findByText(STOCK_COUNT_HELP)).toBeInTheDocument()
  })

  it('test_sold_out_hidden_line_only_when_the_server_says_so', async () => {
    setup(page([], { settings: { ...S, sold_out_hidden: true } }))
    expect(await screen.findByText("Sold-out products don't show in search until you restock.")).toBeInTheDocument()
  })

  it('test_sold_out_hidden_line_absent_when_off', async () => {
    setup(page([]))
    await screen.findByText('Nothing needs restocking right now.')
    expect(screen.queryByText(/Sold-out products/)).toBeNull()
  })

  it('test_alerts_line_only_when_alerts_are_on', async () => {
    setup(page([], { settings: { ...S, alerts_enabled: true } }))
    expect(await screen.findByText('We also tell you in your notifications when a product first runs low or sells out.')).toBeInTheDocument()
  })

  it('test_alerts_line_absent_when_off', async () => {
    setup(page([]))
    await screen.findByText('Nothing needs restocking right now.')
    expect(screen.queryByText(/notifications when a product/)).toBeNull()
  })
})
