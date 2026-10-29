import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { server } from '../../../mocks/server.js'
import GroupingCard from '../GroupingCard.jsx'

const API = 'http://localhost:8000'
const listing = { id: 7, brand: 'Milo', name: 'Tin 400g' }
const base = { listing: 7, groupable: true, barcode: '', store_code: false, catalogue_product: null, request: null }
const req = (o) => ({ id: 31, status: 'pending', source: 'vendor', catalogue_product: null, brand: 'Milo', name: 'Tin 400g', barcode: '', rejection_reason: '', ...o })

function setup(state = base, { post } = {}) {
  const gets = []
  const posts = []
  let current = state
  server.use(
    http.get(`${API}/api/catalogue/mine/7/`, () => { gets.push(1); return HttpResponse.json(current) }),
    http.post(`${API}/api/catalogue/mine/7/requests/`, async ({ request }) => {
      posts.push({ url: 'ask', body: await request.json() })
      return post ? post() : HttpResponse.json({}, { status: 201 })
    }),
    http.post(`${API}/api/catalogue/mine/requests/31/withdraw/`, async ({ request }) => {
      posts.push({ url: 'withdraw', body: await request.json() })
      return HttpResponse.json({})
    }),
  )
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><GroupingCard listing={listing} /></QueryClientProvider>)
  return { gets, posts, set: (s) => { current = s } }
}
const open = () => fireEvent.click(screen.getByRole('button', { name: /Other sellers of this product/ }))
const search = () => screen.getByLabelText('Product name or barcode')

afterEach(() => vi.restoreAllMocks())

describe('GroupingCard', () => {
  it('test_state_is_fetched_only_when_opened', async () => {
    const { gets } = setup()
    await new Promise((r) => setTimeout(r, 30))
    expect(gets).toHaveLength(0)
    open()
    await screen.findByText(/Sell the same branded product/)
    expect(gets).toHaveLength(1)
  })

  it('test_not_groupable_renders_nothing', async () => {
    const { gets } = setup({ ...base, groupable: false })
    open()
    await waitFor(() => expect(gets).toHaveLength(1))
    await waitFor(() => expect(screen.queryByRole('button', { name: /Other sellers/ })).not.toBeInTheDocument())
    expect(document.body.textContent).toBe('')
  })

  it('test_grouped_listing_names_the_product_and_says_only_ashantihub_ungroups', async () => {
    setup({ ...base, catalogue_product: { id: 4, brand: 'Milo', name: 'Tin 400g', barcode: '' } })
    open()
    expect(await screen.findByText('Shown with other sellers of Milo Tin 400g. Only AshantiHub can ungroup it; ask Support if this is wrong.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Find the product' })).not.toBeInTheDocument()
  })

  it('test_ask_by_picking_a_catalogue_product_posts_its_id', async () => {
    const { posts, gets } = setup()
    server.use(http.get(`${API}/api/catalogue/products/`, () => HttpResponse.json({ results: [{ id: 4, brand: 'Milo', name: 'Tin 400g', barcode: '', offer_count: 2, lowest_price: '10.00' }], truncated: false })))
    open()
    await screen.findByText(/Sell the same branded product/)
    fireEvent.change(search(), { target: { value: 'milo' } })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Ask to join' }))
    await waitFor(() => expect(posts).toEqual([{ url: 'ask', body: { catalogue_product: 4 } }]))
    await waitFor(() => expect(gets).toHaveLength(2))
    expect(screen.getByText('AshantiHub staff check every request. Nothing changes until they approve.')).toBeInTheDocument()
  })

  it('test_ask_for_a_new_product_posts_brand_and_name_prefilled_from_the_listing', async () => {
    const { posts } = setup()
    open()
    await screen.findByText(/Sell the same branded product/)
    fireEvent.click(screen.getByRole('button', { name: "It's not listed" }))
    expect(screen.getByLabelText('Brand')).toHaveValue('Milo')
    expect(screen.getByLabelText('Product name')).toHaveValue('Tin 400g')
    fireEvent.change(screen.getByLabelText('Brand'), { target: { value: 'Nestle Milo' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ask AshantiHub to group it' }))
    await waitFor(() => expect(posts).toEqual([{ url: 'ask', body: { brand: 'Nestle Milo', name: 'Tin 400g' } }]))
  })

  it('test_barcode_search_is_prefilled_from_a_grouping_barcode', async () => {
    const seen = []
    setup({ ...base, barcode: '06001234567890' })
    server.use(http.get(`${API}/api/catalogue/products/`, ({ request }) => { seen.push(request.url); return HttpResponse.json({ results: [], truncated: false }) }))
    open()
    await screen.findByText('Barcode 6001234567890')
    expect(search()).toHaveValue('6001234567890')
    expect(seen).toEqual([])
  })

  it('test_store_code_is_explained_and_not_searched', async () => {
    setup({ ...base, barcode: '20000000000123', store_code: true })
    open()
    expect(await screen.findByText("This is a shop's own code, so it cannot be matched. Ask with the brand and name.")).toBeInTheDocument()
    expect(search()).toHaveValue('')
  })

  it('test_no_barcode_line_points_to_edit_details', async () => {
    setup()
    open()
    expect(await screen.findByText('No barcode on this listing. Add it under Edit details, or ask with the brand.')).toBeInTheDocument()
  })

  it('test_waiting_request_shows_withdraw_only_when_the_business_asked', async () => {
    setup({ ...base, request: req({ brand: 'Milo', name: 'Tin 400g' }) })
    open()
    expect(await screen.findByText('Waiting for AshantiHub: new: Milo Tin 400g')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Withdraw' })).toBeInTheDocument()
  })

  it('test_waiting_request_names_the_asked_product', async () => {
    setup({ ...base, request: req({ catalogue_product: { id: 4, brand: 'Omo', name: 'Box', barcode: '' } }) })
    open()
    expect(await screen.findByText('Waiting for AshantiHub: Omo Box')).toBeInTheDocument()
  })

  it('test_barcode_match_waiting_says_ashantihub_decides', async () => {
    setup({ ...base, request: req({ source: 'backfill' }) })
    open()
    expect(await screen.findByText('AshantiHub found this match by barcode and will decide it.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Withdraw' })).not.toBeInTheDocument()
  })

  it('test_withdraw_confirms_then_posts', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { posts, gets } = setup({ ...base, request: req() })
    open()
    fireEvent.click(await screen.findByRole('button', { name: 'Withdraw' }))
    await waitFor(() => expect(posts).toEqual([{ url: 'withdraw', body: {} }]))
    expect(confirm).toHaveBeenCalledWith('Take back this request?')
    await waitFor(() => expect(gets).toHaveLength(2))
  })

  it('test_withdraw_cancelled_sends_nothing', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    const { posts } = setup({ ...base, request: req() })
    open()
    fireEvent.click(await screen.findByRole('button', { name: 'Withdraw' }))
    await new Promise((r) => setTimeout(r, 30))
    expect(posts).toEqual([])
  })

  it('test_rejected_request_shows_the_reason_and_allows_asking_again', async () => {
    setup({ ...base, request: req({ status: 'rejected', rejection_reason: 'Different size' }) })
    open()
    expect(await screen.findByText('Not grouped: Different size')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: "It's not listed" })).toBeInTheDocument()
  })

  it.each(['not_groupable', 'name_required', 'brand_or_barcode_required', 'unknown_product', 'already_grouped', 'request_pending', 'barcode_mismatch', 'not_published', 'account_suspended'])('test_each_refusal_code_shows_the_server_detail %s', async (code) => {
    setup(base, { post: () => HttpResponse.json({ detail: `Server says ${code}.`, code }, { status: 409 }) })
    open()
    await screen.findByText(/Sell the same branded product/)
    fireEvent.click(screen.getByRole('button', { name: "It's not listed" }))
    fireEvent.click(screen.getByRole('button', { name: 'Ask AshantiHub to group it' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(`Server says ${code}.`)
  })

  it('test_429_shows_the_server_detail', async () => {
    setup(base, { post: () => HttpResponse.json({ detail: 'Too many requests. Wait a minute.' }, { status: 429 }) })
    open()
    await screen.findByText(/Sell the same branded product/)
    fireEvent.click(screen.getByRole('button', { name: "It's not listed" }))
    fireEvent.click(screen.getByRole('button', { name: 'Ask AshantiHub to group it' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many requests. Wait a minute.')
  })

  it('test_double_click_posts_once', async () => {
    const { posts, gets } = setup(base, { post: async () => { await new Promise((r) => setTimeout(r, 60)); return HttpResponse.json({}, { status: 201 }) } })
    open()
    await screen.findByText(/Sell the same branded product/)
    fireEvent.click(screen.getByRole('button', { name: "It's not listed" }))
    const b = screen.getByRole('button', { name: 'Ask AshantiHub to group it' })
    fireEvent.click(b)
    fireEvent.click(b)
    await waitFor(() => expect(gets).toHaveLength(2))
    await waitFor(() => expect(b).toBeEnabled())
    expect(posts).toHaveLength(1)
  })

  it('test_no_ungroup_control_for_a_business', async () => {
    setup({ ...base, catalogue_product: { id: 4, brand: 'Milo', name: 'Tin 400g', barcode: '' } })
    open()
    await screen.findByText(/Only AshantiHub can ungroup it/)
    expect(screen.queryByRole('button', { name: /ungroup|remove|leave/i })).not.toBeInTheDocument()
  })
})
