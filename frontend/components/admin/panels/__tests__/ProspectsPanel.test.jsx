import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { server } from '../../../../mocks/server.js'
import ProspectsPanel, { nextLine } from '../ProspectsPanel.jsx'

const API = 'http://localhost:8000'
const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString()
const prospect = (over = {}) => ({
  id: 1, name: 'Ohemaa Waakye Joint', phone: '+233241234567', zone: { id: 1, name: 'Asafo' }, area: 'Asafo', status: 'interested',
  status_label: 'Interested', note: 'Wants to see the monthly price.', next_follow_up_at: day(2), last_visit_at: day(-3), has_pin: true, ...over,
})
const COUNTS = { all: 4, new: 1, interested: 2, follow_up: 0, not_interested: 1, registered: 0 }

function serve(results, { counts = COUNTS, signed = 3, onList } = {}) {
  server.use(http.get(`${API}/api/field/prospects/`, ({ request }) => {
    const status = new URL(request.url).searchParams.get('status')
    onList?.(status)
    return HttpResponse.json({ counts, signed_up_this_month: signed, results: typeof results === 'function' ? results(status) : results })
  }))
}

function renderPanel(props = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={queryClient}><ProspectsPanel {...props} /></QueryClientProvider>)
}

describe('nextLine', () => {
  const now = new Date('2026-10-08T10:00:00')
  it('uses the canvas wording for each state', () => {
    expect(nextLine({ status: 'not_interested', next_follow_up_at: null }, now).text).toBe('Closed · reopen any time')
    expect(nextLine({ status: 'new', next_follow_up_at: null }, now).text).toBe('No follow-up set')
    expect(nextLine({ status: 'new', next_follow_up_at: '2026-10-09T15:00:00' }, now)).toEqual({ text: 'Next: Fri 9 Oct', overdue: false })
    expect(nextLine({ status: 'follow_up', next_follow_up_at: '2026-10-06T15:00:00' }, now)).toEqual({ text: 'Follow up was due Tue 6 Oct', overdue: true })
    // due today but later is not overdue
    expect(nextLine({ status: 'follow_up', next_follow_up_at: '2026-10-08T17:00:00' }, now).overdue).toBe(false)
  })
})

describe('ProspectsPanel', () => {
  it('shows the header, the signed-up line and a card per prospect', async () => {
    serve([prospect(), prospect({ id: 2, name: 'Asafo Fresh Fish', status: 'new', status_label: 'New', note: '', next_follow_up_at: null, last_visit_at: null, area: null, zone: null })])
    renderPanel()
    expect(screen.getByRole('heading', { name: 'Prospects' })).toBeInTheDocument()
    expect(await screen.findByText(/Not registered yet · 3 signed up in /)).toBeInTheDocument()
    const card = screen.getByRole('article', { name: 'Ohemaa Waakye Joint' })
    expect(within(card).getByText('Interested')).toBeInTheDocument()
    expect(within(card).getByText(/^Asafo · last visit /)).toBeInTheDocument()
    expect(within(card).getByText('Wants to see the monthly price.')).toBeInTheDocument()
    expect(within(card).getByText(/^Next: /)).toBeInTheDocument()
    const bare = screen.getByRole('article', { name: 'Asafo Fresh Fish' })
    expect(within(bare).getByText('No area set · no visit yet')).toBeInTheDocument()
    expect(within(bare).getByText('No follow-up set')).toBeInTheDocument()
    expect(screen.getByText("Registering a prospect links it, so your earlier visits stay on the business's record.")).toBeInTheDocument()
  })

  it('shows overdue follow-ups and closed prospects the way the canvas does', async () => {
    serve([
      prospect({ id: 1, name: 'Bantama Timber', status: 'follow_up', status_label: 'Follow up', next_follow_up_at: day(-2) }),
      prospect({ id: 2, name: 'Asafo Mobile Money', status: 'not_interested', status_label: 'Not interested', next_follow_up_at: null }),
    ])
    renderPanel()
    const overdue = await screen.findByRole('article', { name: 'Bantama Timber' })
    expect(within(overdue).getByText(/^Follow up was due /)).toBeInTheDocument()
    const closed = screen.getByRole('article', { name: 'Asafo Mobile Money' })
    expect(within(closed).getByText('Closed · reopen any time')).toBeInTheDocument()
    expect(within(closed).queryByRole('button', { name: 'Register' })).not.toBeInTheDocument()
    expect(within(closed).queryByRole('link', { name: /Call/ })).not.toBeInTheDocument()
  })

  it('filters by status with counts on the pills', async () => {
    const asked = []
    serve((status) => (status === 'not_interested' ? [prospect({ id: 9, name: 'Closed one', status: 'not_interested', status_label: 'Not interested', next_follow_up_at: null })] : [prospect()]), { onList: (s) => asked.push(s) })
    renderPanel()
    await screen.findByRole('article', { name: 'Ohemaa Waakye Joint' })
    const group = screen.getByRole('group', { name: 'Filter by status' })
    expect(within(group).getAllByRole('button').map((b) => b.textContent)).toEqual(['All4', 'New1', 'Interested2', 'Follow up0', 'Not interested1'])
    fireEvent.click(within(group).getByRole('button', { name: /Not interested/ }))
    expect(await screen.findByRole('article', { name: 'Closed one' })).toBeInTheDocument()
    expect(within(group).getByRole('button', { name: /Not interested/ })).toHaveAttribute('aria-pressed', 'true')
    expect(asked).toEqual(['all', 'not_interested'])
  })

  it('says so when there are no prospects', async () => {
    serve([], { counts: { all: 0 } })
    renderPanel()
    expect(await screen.findByText(/No prospects yet/)).toBeInTheDocument()
  })

  it('adds a prospect without reading the location', async () => {
    let body = null
    const geo = vi.fn()
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition: geo, watchPosition: geo } })
    server.use(
      http.get(`${API}/api/listings/zones/`, () => HttpResponse.json([{ id: 1, name: 'Asafo' }, { id: 2, name: 'Bantama' }])),
      http.post(`${API}/api/field/prospects/`, async ({ request }) => { body = await request.json(); return HttpResponse.json(prospect(), { status: 201 }) }),
    )
    serve([])
    renderPanel()
    fireEvent.click(await screen.findByRole('button', { name: 'Add prospect' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add prospect' })
    await within(dialog).findByRole('option', { name: 'Bantama' })
    fireEvent.change(within(dialog).getByLabelText('Business name'), { target: { value: 'Golden Needle Tailoring' } })
    fireEvent.change(within(dialog).getByLabelText('Phone'), { target: { value: '024 123 4567' } })
    fireEvent.change(within(dialog).getByLabelText('Area'), { target: { value: '2' } })
    fireEvent.change(within(dialog).getByLabelText('Note'), { target: { value: 'Ghana Card at home' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add prospect' }))
    await waitFor(() => expect(body).not.toBeNull())
    expect(body).toMatchObject({ name: 'Golden Needle Tailoring', phone: '024 123 4567', zone: 2, note: 'Ghana Card at home' })
    expect(body).not.toHaveProperty('lat')
    expect(geo).not.toHaveBeenCalled()
    expect(await screen.findByText('Prospect added.')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    delete navigator.geolocation
  })

  it('shows the server message when a phone already belongs to a business', async () => {
    server.use(http.post(`${API}/api/field/prospects/`, () => HttpResponse.json({ detail: 'This phone number already belongs to another business.' }, { status: 400 })))
    serve([])
    renderPanel()
    fireEvent.click(await screen.findByRole('button', { name: 'Add prospect' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Business name'), { target: { value: 'X' } })
    fireEvent.change(within(dialog).getByLabelText('Phone'), { target: { value: '0241234567' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add prospect' }))
    expect(await within(dialog).findByText('This phone number already belongs to another business.')).toBeInTheDocument()
  })

  it('edits a prospect and sends only a changed follow-up date', async () => {
    let body = null
    server.use(
      http.get(`${API}/api/listings/zones/`, () => HttpResponse.json([{ id: 1, name: 'Asafo' }])),
      http.patch(`${API}/api/field/prospects/1/`, async ({ request }) => { body = await request.json(); return HttpResponse.json(prospect()) }),
    )
    serve([prospect()])
    renderPanel()
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Ohemaa Waakye Joint' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit prospect' })
    fireEvent.change(within(dialog).getByLabelText('Status'), { target: { value: 'follow_up' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(body).not.toBeNull())
    expect(body).toMatchObject({ status: 'follow_up', name: 'Ohemaa Waakye Joint' })
    expect(body).not.toHaveProperty('next_follow_up_at')
  })

  describe('an overdue prospect', () => {
    const overdue = () => prospect({ status: 'follow_up', status_label: 'Follow up', next_follow_up_at: day(-4) })
    const open = async (patch) => {
      let body = null
      server.use(
        http.get(`${API}/api/listings/zones/`, () => HttpResponse.json([{ id: 1, name: 'Asafo' }])),
        http.patch(`${API}/api/field/prospects/1/`, async ({ request }) => { body = await request.json(); patch?.(body); return HttpResponse.json(prospect()) }),
      )
      serve([overdue()])
      renderPanel()
      fireEvent.click(await screen.findByRole('button', { name: 'Edit Ohemaa Waakye Joint' }))
      const dialog = await screen.findByRole('dialog', { name: 'Edit prospect' })
      return { dialog, body: () => body }
    }

    it('can have its note edited while the follow-up date stays as it was', async () => {
      const { dialog, body } = await open()
      fireEvent.change(within(dialog).getByLabelText('Note'), { target: { value: 'Will call back Friday' } })
      fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }))
      await waitFor(() => expect(body()).not.toBeNull())
      expect(body()).toMatchObject({ note: 'Will call back Friday' })
      expect(body()).not.toHaveProperty('next_follow_up_at')
      expect(screen.queryByText('Pick a follow-up day from today on.')).not.toBeInTheDocument()
    })

    it('still refuses a newly picked date in the past', async () => {
      const { dialog, body } = await open()
      fireEvent.change(within(dialog).getByLabelText('Follow-up date'), { target: { value: '2020-01-01' } })
      fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }))
      expect(await within(dialog).findByText('Pick a follow-up day from today on.')).toBeInTheDocument()
      expect(body()).toBeNull()
    })

    it('can be marked Not interested, which clears the overdue follow-up', async () => {
      const { dialog, body } = await open()
      fireEvent.change(within(dialog).getByLabelText('Status'), { target: { value: 'not_interested' } })
      fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }))
      await waitFor(() => expect(body()).not.toBeNull())
      expect(body()).toMatchObject({ status: 'not_interested', next_follow_up_at: null })
    })
  })

  it('places a pin by hand and sends lat and lng with the edit', async () => {
    let body = null
    server.use(
      http.get(`${API}/api/listings/zones/`, () => HttpResponse.json([{ id: 1, name: 'Asafo' }])),
      http.patch(`${API}/api/field/prospects/1/`, async ({ request }) => { body = await request.json(); return HttpResponse.json(prospect()) }),
    )
    serve([prospect({ has_pin: false })])
    renderPanel()
    expect(screen.queryByText('Pinned')).not.toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Ohemaa Waakye Joint' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit prospect' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Place pin' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'drop-pin' })) // LocationPicker stub (test/setup.js)
    expect(within(dialog).getByText('New pin placed by hand. Save to keep it.')).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(body).not.toBeNull())
    expect(body).toMatchObject({ lat: 6.7, lng: -1.62 })
  })

  it('opens the pin picker at the prospect\'s existing pin', async () => {
    server.use(http.get(`${API}/api/listings/zones/`, () => HttpResponse.json([{ id: 1, name: 'Asafo' }])))
    serve([prospect({ has_pin: true, lat: 6.69, lng: -1.61 })])
    renderPanel()
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Ohemaa Waakye Joint' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit prospect' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move pin' }))
    const picker = within(dialog).getByRole('button', { name: 'drop-pin' })
    expect(picker).toHaveAttribute('data-lat', '6.69')
    expect(picker).toHaveAttribute('data-lng', '-1.61')
  })

  it('shows a Pinned marker once a prospect has a pin, and a ghost Register button', async () => {
    serve([prospect({ has_pin: true })])
    renderPanel()
    const card = await screen.findByRole('article', { name: 'Ohemaa Waakye Joint' })
    expect(within(card).getByText('Pinned')).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: 'Register' })).toHaveStyle({ background: '#FDF6E3' })
    expect(card.textContent).not.toContain('📞')
  })

  it('the Call button dials the prospect and opens Log a call for them', async () => {
    server.use(
      http.get(`${API}/api/calls/counterparts/`, () => HttpResponse.json({ businesses: [], prospects: [{ id: 1, name: 'Ohemaa Waakye Joint', phone_masked: '024 *** 567', status: 'interested' }] })),
      http.get(`${API}/api/calls/purposes/`, () => HttpResponse.json([{ value: 'subscription_payment', label: 'Subscription reminder' }, { value: 'prospecting', label: 'Prospecting' }])),
    )
    serve([prospect()])
    renderPanel()
    const call = await screen.findByRole('link', { name: 'Call Ohemaa Waakye Joint' })
    expect(call).toHaveAttribute('href', 'tel:+233241234567')
    call.addEventListener('click', (e) => e.preventDefault()) // don't let jsdom navigate
    fireEvent.click(call)
    const dialog = await screen.findByRole('dialog', { name: 'Log a call' })
    expect(await within(dialog).findByText('Phone 024 *** 567 · from the prospect list')).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Purpose')).toHaveValue('prospecting')
  })

  it('Register hands the prospect to the wizard', async () => {
    const onRegister = vi.fn()
    serve([prospect()])
    renderPanel({ onRegister })
    fireEvent.click(await screen.findByRole('button', { name: 'Register' }))
    expect(onRegister).toHaveBeenCalledWith(expect.objectContaining({ id: 1, name: 'Ohemaa Waakye Joint' }))
  })
})
