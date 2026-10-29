import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../../../mocks/server.js'
import CatalogueQueuePanel from '../CatalogueQueuePanel.jsx'

const API = 'http://localhost:8000/api/catalogue/staff'
const milo = { id: 4, brand: 'Nestle', name: 'Milo 400g', barcode: '06001068011001' }
const milo2 = { id: 5, brand: 'Nestle', name: 'Milo Tin 400g', barcode: '' }

const row = (o = {}) => ({
  id: 1, status: 'pending', source: 'vendor', brand: 'Nestle', name: 'Milo 400g', barcode: '6001068011001',
  catalogue_product: null, rejection_reason: '', created_at: '2026-10-20T08:00:00Z', reviewed_at: null, reviewed_by_name: null,
  matches: [],
  ...o,
  listing: {
    id: 21, name: 'Milo tin', brand: 'Nestle', barcode: '06001068011001', status: 'published', price_amount: '45.00',
    business_name: 'Akosua Ntoma Store', business_suspended: false, grouped_with: null, ...(o.listing || {}),
  },
})
const page = (results, o = {}) => ({ count: results.length, next: null, previous: null, results, ...o })

function mockQueue(byStatus, calls = []) {
  server.use(http.get(`${API}/requests/pending/`, ({ request }) => {
    const url = new URL(request.url)
    const status = url.searchParams.get('status')
    calls.push({ status, page: url.searchParams.get('page') })
    return HttpResponse.json(byStatus[status] || page([]))
  }))
  return calls
}
function capturePost(path, response = {}, status = 200) {
  const sent = { body: null, count: 0 }
  server.use(http.post(`${API}/${path}`, async ({ request }) => {
    sent.body = await request.json(); sent.count += 1
    return HttpResponse.json(response, { status })
  }))
  return sent
}
function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={queryClient}><CatalogueQueuePanel /></QueryClientProvider>)
}
const tab = (name) => fireEvent.click(screen.getByRole('button', { name: new RegExp(name) }))

describe('CatalogueQueuePanel', () => {
  it('test_pending_is_the_default_tab_in_server_order', async () => {
    mockQueue({ pending: page([row({ id: 1, listing: { name: 'First tin' } }), row({ id: 2, listing: { id: 22, name: 'Second tin' } })]) })
    renderPanel()
    const first = await screen.findByText('First tin')
    const second = screen.getByText('Second tin')
    expect(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Pending/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('Showing 2 of 2')).toBeInTheDocument()
  })

  it('test_row_shows_listing_business_barcode_and_the_ask', async () => {
    mockQueue({ pending: page([row({ catalogue_product: milo })]) })
    renderPanel()
    expect(await screen.findByText('Milo tin')).toBeInTheDocument()
    expect(screen.getByText(/Akosua Ntoma Store/)).toBeInTheDocument()
    expect(screen.getByText(/Barcode 6001068011001/)).toBeInTheDocument()
    expect(screen.getByText(/GH₵ 45\.00/)).toBeInTheDocument()
    expect(screen.getByText('Asked by the business')).toBeInTheDocument()
    expect(screen.getByText('Join Nestle Milo 400g')).toBeInTheDocument()
  })

  it('shows a new-product ask in words', async () => {
    mockQueue({ pending: page([row()]) })
    renderPanel()
    expect(await screen.findByText('New catalogue product: Nestle Milo 400g')).toBeInTheDocument()
  })

  it('test_backfill_rows_say_found_by_barcode', async () => {
    mockQueue({ pending: page([row({ source: 'backfill', catalogue_product: milo })]) })
    renderPanel()
    expect(await screen.findByText("Found by AshantiHub's barcode check")).toBeInTheDocument()
    expect(screen.queryByText('Asked by the business')).not.toBeInTheDocument()
  })

  it('test_suspended_business_is_flagged_in_words', async () => {
    mockQueue({ pending: page([row({ listing: { business_suspended: true } })]) })
    renderPanel()
    expect(await screen.findByText('Business suspended')).toBeInTheDocument()
  })

  it('test_approve_joining_a_match_posts_its_id', async () => {
    mockQueue({ pending: page([row({ matches: [milo, milo2] })]) })
    const sent = capturePost('requests/1/approve/', { request: {}, catalogue_product: milo2 })
    renderPanel()
    fireEvent.click(await screen.findByRole('radio', { name: /Nestle Milo Tin 400g/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    await waitFor(() => expect(sent.body).toEqual({ catalogue_product: 5 }))
  })

  it('test_approve_new_posts_brand_and_name_without_the_new_flag', async () => {
    mockQueue({ pending: page([row({ matches: [] })]) })
    const sent = capturePost('requests/1/approve/', { request: {}, catalogue_product: milo })
    renderPanel()
    fireEvent.change(await screen.findByLabelText('Brand'), { target: { value: 'Nestlé' } })
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Milo 400 g' } })
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    await waitFor(() => expect(sent.body).toEqual({ brand: 'Nestlé', name: 'Milo 400 g' }))
    expect(sent.body).not.toHaveProperty('new')
  })

  it('test_match_exists_lists_the_matches_and_create_anyway_sends_new_true', async () => {
    mockQueue({ pending: page([row()]) })
    const bodies = []
    server.use(http.post(`${API}/requests/1/approve/`, async ({ request }) => {
      const body = await request.json(); bodies.push(body)
      if (body.new === true) return HttpResponse.json({ request: {}, catalogue_product: milo })
      return HttpResponse.json({ detail: 'A product with this name already exists.', code: 'match_exists', matches: [milo, milo2] }, { status: 409 })
    }))
    renderPanel()
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }))
    expect(await screen.findByText('A product with this name already exists.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Join Nestle Milo 400g' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Join Nestle Milo Tin 400g' })).toBeInTheDocument()
    expect(bodies).toEqual([{ brand: 'Nestle', name: 'Milo 400g' }])
    fireEvent.click(screen.getByRole('button', { name: 'Create new anyway' }))
    await waitFor(() => expect(bodies[1]).toEqual({ brand: 'Nestle', name: 'Milo 400g', new: true }))
  })

  it('a join choice from the conflict posts that product without new', async () => {
    mockQueue({ pending: page([row()]) })
    const bodies = []
    server.use(http.post(`${API}/requests/1/approve/`, async ({ request }) => {
      const body = await request.json(); bodies.push(body)
      if (body.catalogue_product) return HttpResponse.json({ request: {}, catalogue_product: milo })
      return HttpResponse.json({ detail: 'Exists.', code: 'match_exists', matches: [milo] }, { status: 409 })
    }))
    renderPanel()
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Join Nestle Milo 400g' }))
    await waitFor(() => expect(bodies[1]).toEqual({ catalogue_product: 4 }))
  })

  it('test_reject_needs_a_reason', async () => {
    mockQueue({ pending: page([row()]) })
    const sent = capturePost('requests/1/reject/', {})
    renderPanel()
    fireEvent.click(await screen.findByRole('button', { name: 'Reject' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm reject' }))
    expect(await screen.findByText('Give a reason the business will see.')).toBeInTheDocument()
    expect(sent.count).toBe(0)
    fireEvent.change(screen.getByLabelText('Rejection reason'), { target: { value: 'Different size' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm reject' }))
    await waitFor(() => expect(sent.body).toEqual({ reason: 'Different size' }))
  })

  it('shows the server reason error on reject', async () => {
    mockQueue({ pending: page([row()]) })
    server.use(http.post(`${API}/requests/1/reject/`, () => HttpResponse.json({ reason: 'A reason is required.' }, { status: 400 })))
    renderPanel()
    fireEvent.click(await screen.findByRole('button', { name: 'Reject' }))
    fireEvent.change(screen.getByLabelText('Rejection reason'), { target: { value: ' x ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm reject' }))
    expect(await screen.findByText('A reason is required.')).toBeInTheDocument()
  })

  it('test_re_review_on_a_rejected_row', async () => {
    mockQueue({ pending: page([]), rejected: page([row({ status: 'rejected', rejection_reason: 'Different size' })]) })
    const sent = capturePost('requests/1/re-review/', {})
    renderPanel()
    await screen.findByText('No pending items.')
    tab('Rejected')
    expect(await screen.findByText(/Different size/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Review Again/ }))
    await waitFor(() => expect(sent.count).toBe(1))
  })

  it('test_ungroup_needs_a_reason_and_posts_detach_for_the_listing', async () => {
    mockQueue({ approved: page([row({ status: 'approved', reviewed_by_name: 'Kofi Mensah', reviewed_at: '2026-10-21T09:00:00Z', catalogue_product: milo, listing: { grouped_with: milo } })]) })
    const sent = { body: null, count: 0 }
    server.use(http.post('http://localhost:8000/api/catalogue/staff/listings/21/detach/', async ({ request }) => {
      sent.body = await request.json(); sent.count += 1
      return HttpResponse.json({ listing: 21, catalogue_product: null })
    }))
    renderPanel()
    tab('Approved')
    expect(await screen.findByText(/Approved by Kofi Mensah/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Ungroup…' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm ungroup' }))
    expect(await screen.findByText('Give a reason the business will see.')).toBeInTheDocument()
    expect(sent.count).toBe(0)
    fireEvent.change(screen.getByLabelText('Reason for ungrouping'), { target: { value: 'Wrong pack size' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm ungroup' }))
    await waitFor(() => expect(sent.body).toEqual({ reason: 'Wrong pack size' }))
  })

  it('test_approved_row_no_longer_grouped_has_no_ungroup', async () => {
    mockQueue({ approved: page([row({ status: 'approved', reviewed_by_name: 'Kofi Mensah', listing: { grouped_with: null } })]) })
    renderPanel()
    tab('Approved')
    expect(await screen.findByText('No longer grouped')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Ungroup…' })).not.toBeInTheDocument()
  })

  it('test_not_pending_conflict_shows_detail_and_refetches', async () => {
    const calls = mockQueue({ pending: page([row()]) })
    server.use(http.post(`${API}/requests/1/approve/`, () => HttpResponse.json({ detail: 'Someone else already decided this request.', code: 'not_pending' }, { status: 409 })))
    renderPanel()
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }))
    expect(await screen.findByText('Someone else already decided this request.')).toBeInTheDocument()
    await waitFor(() => {
      for (const status of ['pending', 'approved', 'rejected']) expect(calls.filter((c) => c.status === status).length).toBeGreaterThanOrEqual(status === 'pending' ? 2 : 1)
    })
    await waitFor(() => expect(calls.filter((c) => c.status === 'approved').length).toBeGreaterThanOrEqual(2))
    expect(calls.filter((c) => c.status === 'rejected').length).toBeGreaterThanOrEqual(2)
  })

  it('test_next_page_follows_the_envelope', async () => {
    const calls = mockQueue({ pending: page([row()], { count: 51, next: `${API}/requests/pending/?page=2` }) })
    renderPanel()
    expect(await screen.findByText('Showing 1 of 51')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Previous page' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    await waitFor(() => expect(calls.some((c) => c.status === 'pending' && c.page === '2')).toBe(true))
  })

  it('test_no_contact_links', async () => {
    mockQueue({ pending: page([row({ catalogue_product: milo, matches: [milo] })]) })
    const { container } = render(<div />)
    renderPanel()
    await screen.findByText('Milo tin')
    expect(document.querySelectorAll('a[href^="tel:"], a[href^="mailto:"], a[href*="wa.me"]').length).toBe(0)
    expect(container).toBeTruthy()
    expect(within(document.body).queryByText(/whatsapp|call the business/i)).not.toBeInTheDocument()
  })
})
