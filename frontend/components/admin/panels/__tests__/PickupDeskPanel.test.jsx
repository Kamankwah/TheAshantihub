import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setStoredAuth } from '../../../../apiClient.js'
import { server } from '../../../../mocks/server.js'
import AdminCommandCenter from '../../AdminCommandCenter.jsx'
import SudoPrompt from '../../SudoPrompt.jsx'
import PickupDeskPanel from '../PickupDeskPanel.jsx'

const LIST = 'http://localhost:8000/api/ledger/pickup/'
const COLLECTED = 'http://localhost:8000/api/ledger/pickup/:id/collected/'
const SETTINGS = 'http://localhost:8000/api/core/site-settings/'
const ADDRESS = 'http://localhost:8000/api/core/site-settings/pickup-address/'
const wrap = (ui) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>)
const envelope = (results, count = results.length) => HttpResponse.json({ count, next: null, previous: null, results })
const desk = { user: { role: 'pickup_desk' }, hasPermission: (c) => c === 'pickup.confirm' }
const admin = { user: { role: 'super_admin' }, hasPermission: () => true }
const row = (over = {}) => ({
  order_id: 41, placed_at: '2026-10-20T10:00:00Z', collect_by: '2026-10-23T10:00:00Z', overdue: false, customer_name: 'Ama Mensah',
  items: [{ name: 'Solar lamp', quantity: 2, business: 'Bright Stores' }], ...over,
})
const CODE_LABEL = 'Collection code'

async function openHandOver() {
  fireEvent.click(await screen.findByRole('button', { name: /Hand over/ }))
  return screen.findByLabelText(CODE_LABEL)
}
const typeCode = (input, value) => fireEvent.change(input, { target: { value } })

describe('Pickup desk', () => {
  it('lists waiting orders with collect-by and an Overdue word', async () => {
    server.use(http.get(LIST, () => envelope([row(), row({ order_id: 42, customer_name: 'Kofi Boateng', overdue: true, items: [{ name: 'Rice 5kg', quantity: 1, business: 'Fresh Mart' }] })])))
    wrap(<PickupDeskPanel auth={desk} />)
    expect(await screen.findByText('Order #41')).toBeInTheDocument()
    expect(screen.getByText('Ama Mensah')).toBeInTheDocument()
    expect(screen.getByText('2 × Solar lamp, Bright Stores')).toBeInTheDocument()
    expect(screen.getByText('1 × Rice 5kg, Fresh Mart')).toBeInTheDocument()
    expect(screen.getAllByText(new RegExp(`Collect by ${new Date('2026-10-23T10:00:00Z').toLocaleString('en-GH').replace(/[/.()]/g, '\\$&')}`)).length).toBe(2)
    expect(screen.getAllByText('Overdue')).toHaveLength(1)
    expect(screen.getByText('2 waiting')).toBeInTheDocument()
  })

  it('never shows a phone number', async () => {
    server.use(http.get(LIST, () => envelope([row()])))
    const { container } = wrap(<PickupDeskPanel auth={desk} />)
    await screen.findByText('Order #41')
    expect(container.querySelector('a[href^="tel:"]')).toBeNull()
    expect(container.textContent).not.toMatch(/\+233|\b0\d{2}\s?\d{3}\s?\d{4}\b/)
  })

  it('hand over asks for the collection code and posts it once', async () => {
    const posts = []
    server.use(
      http.get(LIST, () => envelope([row()])),
      http.post(COLLECTED, async ({ request, params }) => { posts.push([params.id, await request.json()]); return HttpResponse.json({ order: 41, collected_at: '2026-10-21T09:30:00Z' }) }),
    )
    wrap(<PickupDeskPanel auth={desk} />)
    const input = await openHandOver()
    expect(screen.getByText('Give order #41 to Ama Mensah? Ask for their collection code and check the name.')).toBeInTheDocument()
    expect(input).toHaveAttribute('inputmode', 'numeric')
    expect(input).toHaveAttribute('autocomplete', 'off')
    const confirm = screen.getByRole('button', { name: 'Confirm hand-over' })
    typeCode(input, '01234')
    expect(confirm).toBeDisabled()
    typeCode(input, '012345')
    expect(confirm).toBeEnabled()
    fireEvent.click(confirm)
    fireEvent.click(confirm)
    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent('Order #41 handed over at')
    expect(posts).toEqual([['41', { code: '012345' }]])
  })

  it('shows the hand-over time the server recorded', async () => {
    server.use(
      http.get(LIST, () => envelope([row()])),
      http.post(COLLECTED, () => HttpResponse.json({ order: 41, collected_at: '2026-10-21T09:30:00Z' })),
    )
    wrap(<PickupDeskPanel auth={desk} />)
    typeCode(await openHandOver(), '123456')
    fireEvent.click(screen.getByRole('button', { name: 'Confirm hand-over' }))
    const when = new Date('2026-10-21T09:30:00Z').toLocaleString('en-GH')
    expect(await screen.findByText(`Order #41 handed over at ${when}.`)).toBeInTheDocument()
  })

  it('a wrong code shows the server text and the tries left', async () => {
    server.use(
      http.get(LIST, () => envelope([row()])),
      http.post(COLLECTED, () => HttpResponse.json({ detail: 'That code is not right.', code: 'wrong_code', attempts_left: 3 }, { status: 400 })),
    )
    wrap(<PickupDeskPanel auth={desk} />)
    typeCode(await openHandOver(), '123456')
    fireEvent.click(screen.getByRole('button', { name: 'Confirm hand-over' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('That code is not right. 3 tries left.')
    expect(screen.getByRole('button', { name: 'Confirm hand-over' })).toBeEnabled()
  })

  it('a locked order shows the server text and offers no retry', async () => {
    server.use(
      http.get(LIST, () => envelope([row()])),
      http.post(COLLECTED, () => HttpResponse.json({ detail: 'Too many wrong codes for this order. Support has been told.', code: 'code_locked' }, { status: 423 })),
    )
    wrap(<PickupDeskPanel auth={desk} />)
    typeCode(await openHandOver(), '123456')
    fireEvent.click(screen.getByRole('button', { name: 'Confirm hand-over' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many wrong codes for this order. Support has been told.')
    expect(screen.queryByRole('button', { name: 'Confirm hand-over' })).toBeNull()
    expect(screen.queryByLabelText(CODE_LABEL)).toBeNull()
  })

  it('a refusal shows the server text', async () => {
    server.use(
      http.get(LIST, () => envelope([row()])),
      http.post(COLLECTED, () => HttpResponse.json({ detail: 'This order has already been collected.' }, { status: 409 })),
    )
    wrap(<PickupDeskPanel auth={desk} />)
    typeCode(await openHandOver(), '123456')
    fireEvent.click(screen.getByRole('button', { name: 'Confirm hand-over' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('This order has already been collected.')
  })

  it('a 409 closes the confirm and refetches the queue', async () => {
    let lists = 0
    server.use(
      http.get(LIST, () => { lists += 1; return envelope([row()]) }),
      http.post(COLLECTED, () => HttpResponse.json({ detail: 'This order has already been collected.' }, { status: 409 })),
    )
    wrap(<PickupDeskPanel auth={desk} />)
    typeCode(await openHandOver(), '123456')
    fireEvent.click(screen.getByRole('button', { name: 'Confirm hand-over' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('This order has already been collected.')
    expect(screen.queryByLabelText(CODE_LABEL)).toBeNull()
    await waitFor(() => expect(lists).toBeGreaterThan(1))
  })

  it('searches by number or name', async () => {
    const seen = []
    server.use(http.get(LIST, ({ request }) => { seen.push(new URL(request.url).searchParams.get('q')); return envelope([]) }))
    wrap(<PickupDeskPanel auth={desk} />)
    await waitFor(() => expect(seen).toEqual(['']))
    fireEvent.change(screen.getByLabelText('Order number or name'), { target: { value: 'Ama' } })
    expect(seen).toEqual([''])
    fireEvent.submit(screen.getByRole('search'))
    await waitFor(() => expect(seen).toContain('Ama'))
  })

  it('pages when there are more than twenty', async () => {
    const pages = []
    server.use(http.get(LIST, ({ request }) => { pages.push(new URL(request.url).searchParams.get('page')); return envelope([row()], 25) }))
    wrap(<PickupDeskPanel auth={desk} />)
    expect(await screen.findByText('25 waiting')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await waitFor(() => expect(pages).toContain('2'))
    expect(await screen.findByRole('button', { name: 'Next' })).toBeDisabled()
  })

  it('shows an honest empty state', async () => {
    wrap(<PickupDeskPanel auth={desk} />)
    expect(await screen.findByText('No orders are waiting for collection.')).toBeInTheDocument()
  })

  it('ledger off shows one honest line', async () => {
    server.use(http.get(LIST, () => HttpResponse.json({ detail: "The ledger isn't switched on yet.", code: 'ledger_off' }, { status: 409 })))
    wrap(<PickupDeskPanel auth={desk} />)
    expect(await screen.findByText('The pickup desk opens when the ledger is switched on.')).toBeInTheDocument()
    expect(screen.queryByText('No orders are waiting for collection.')).toBeNull()
  })

  it('shows the pickup office address, or to be confirmed while it is blank', async () => {
    wrap(<PickupDeskPanel auth={desk} />)
    expect(await screen.findByText('Pickup office address: to be confirmed')).toBeInTheDocument()
    server.use(http.get(SETTINGS, () => HttpResponse.json({ pickup_office_address: 'Adum, next to the Post Office' })))
    wrap(<PickupDeskPanel auth={desk} />)
    expect(await screen.findByText('Pickup office address: Adum, next to the Post Office')).toBeInTheDocument()
  })

  it('a Super Admin edits the address after the password prompt', async () => {
    let calls = 0
    const bodies = []
    server.use(
      http.get(SETTINGS, () => HttpResponse.json({ pickup_office_address: '' })),
      http.patch(ADDRESS, async ({ request }) => {
        calls += 1
        if (calls === 1) return HttpResponse.json({ detail: 'Re-enter your password to continue.', code: 'sudo_required' }, { status: 403 })
        const body = await request.json()
        bodies.push(body)
        return HttpResponse.json(body)
      }),
      http.post('http://localhost:8000/api/accounts/staff/reauth/', () => HttpResponse.json({ sudo_until: '2026-10-21T12:00:00Z' })),
    )
    wrap(<><SudoPrompt /><PickupDeskPanel auth={admin} /></>)
    fireEvent.click(await screen.findByRole('button', { name: 'Edit address' }))
    expect(screen.getByText("Leave it empty to show 'address to be confirmed' everywhere.")).toBeInTheDocument()
    const box = screen.getByLabelText('Pickup office address')
    expect(box).toHaveAttribute('maxlength', '300')
    fireEvent.change(box, { target: { value: 'Adum, next to the Post Office' } })
    server.use(http.get(SETTINGS, () => HttpResponse.json({ pickup_office_address: 'Adum, next to the Post Office' })))
    fireEvent.click(screen.getByRole('button', { name: 'Save address' }))
    fireEvent.change(await screen.findByLabelText('Password'), { target: { value: 'correct-horse-1' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Confirm' })) })
    expect(await screen.findByText('Pickup office address: Adum, next to the Post Office')).toBeInTheDocument()
    expect(bodies).toEqual([{ pickup_office_address: 'Adum, next to the Post Office' }])
    expect(calls).toBe(2)
  })

  it('shows the server text when saving the address is refused', async () => {
    server.use(http.patch(ADDRESS, () => HttpResponse.json({ pickup_office_address: ['Ensure this field has no more than 300 characters.'] }, { status: 400 })))
    wrap(<PickupDeskPanel auth={admin} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Edit address' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save address' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Ensure this field has no more than 300 characters.')
  })

  it('the Pickup Desk role sees no address editor', async () => {
    wrap(<PickupDeskPanel auth={desk} />)
    await screen.findByText('Pickup office address: to be confirmed')
    expect(screen.queryByRole('button', { name: 'Edit address' })).toBeNull()
  })
})

describe('Pickup desk as the role overview', () => {
  beforeEach(() => setStoredAuth({ token: 't', account_type: 'staff', id: 1, full_name: 'Esi Desk' }))
  afterEach(() => { vi.restoreAllMocks(); setStoredAuth(null) })

  it('a pickup_desk session sees the desk as its overview', async () => {
    server.use(http.get(LIST, () => envelope([row()])))
    const auth = { user: { token: 't', account_type: 'staff', id: 1, full_name: 'Esi Desk', role: 'pickup_desk', permissions: ['pickup.confirm'] }, hasPermission: (c) => c === 'pickup.confirm', logout: vi.fn() }
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><AdminCommandCenter auth={auth} onExit={vi.fn()} /></QueryClientProvider>)
    expect(await screen.findByText('Order #41')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Pickup desk' })).toBeInTheDocument()
  })
})
