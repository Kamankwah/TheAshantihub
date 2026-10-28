import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { UserPanel } from './App.jsx'
import { server } from './mocks/server.js'

// UserPanel's Orders/My Events/Saved tabs use react-query hooks
// (useOrders/useMyEvents/useListing via FavDrawerItem) — same isolated-
// QueryClientProvider convention as StaffDashboard.test.jsx.
function renderWithQueryClient(ui) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

function makeUser(overrides = {}) {
  return { fullName: 'Ama Boateng', accountType: 'customer', id: 1, avatar: null, ...overrides }
}

function makeAuth(overrides = {}) {
  return {
    updateProfile: vi.fn().mockResolvedValue({}),
    refreshUser: vi.fn().mockResolvedValue({}),
    ...overrides,
  }
}

function renderPanel(props = {}) {
  return renderWithQueryClient(
    <UserPanel
      user={makeUser()}
      auth={makeAuth()}
      favourites={[]}
      toggleFav={vi.fn()}
      onExit={vi.fn()}
      {...props}
    />,
  )
}

describe('UserPanel', () => {
  it('renders all 8 nav tabs and defaults to the Overview tab', () => {
    renderPanel()
    ;['Overview', 'Orders & Delivery', 'Saved Businesses', 'Messages', 'My Events', 'My Tickets', 'Profile', 'Settings'].forEach((label) => {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0)
    })
    // Overview tab content (a KPI card) is visible by default.
    expect(screen.getByText('Total Orders')).toBeInTheDocument()
  })

  it('calls onExit when the Exit button is clicked', () => {
    const onExit = vi.fn()
    renderPanel({ onExit })
    fireEvent.click(screen.getByText('← Exit'))
    expect(onExit).toHaveBeenCalledTimes(1)
  })

  describe('Profile tab', () => {
    it('saving calls auth.updateProfile then auth.refreshUser and shows a confirmation', async () => {
      const updateProfile = vi.fn().mockResolvedValue({})
      const refreshUser = vi.fn().mockResolvedValue({})
      renderPanel({ auth: { updateProfile, refreshUser } })
      fireEvent.click(screen.getAllByText('Profile')[0])
      fireEvent.change(screen.getByDisplayValue('Ama Boateng'), { target: { value: 'Ama Owusu' } })
      fireEvent.click(screen.getByText('Save Changes'))
      await waitFor(() => expect(updateProfile).toHaveBeenCalledWith(
        expect.objectContaining({ full_name: 'Ama Owusu', avatar: null }),
      ))
      await waitFor(() => expect(refreshUser).toHaveBeenCalledTimes(1))
      await screen.findByText('✓ Saved!')
    })

    it('shows primary email/phone as read-only, with a separate editable/verifiable recovery pair', async () => {
      server.use(
        http.get('http://localhost:8000/api/accounts/customers/me/profile/', () =>
          HttpResponse.json({
            id: 1, full_name: 'Ama Boateng', avatar: null, email: 'ama@example.com', phone: '0244000111',
            address: null, gender: null, date_of_birth: null,
            secondary_email: null, secondary_email_verified: false,
            secondary_phone: null, secondary_phone_verified: false,
            email_notifications_enabled: true, sms_notifications_enabled: true,
          }),
        ),
      )
      renderPanel()
      fireEvent.click(screen.getAllByText('Profile')[0])
      // Primary email/phone are disabled, read-only display fields.
      expect(await screen.findByDisplayValue('ama@example.com')).toBeDisabled()
      expect(screen.getByDisplayValue('0244000111')).toBeDisabled()
      // Recovery email/phone are real, enabled, editable inputs (not disabled).
      expect(screen.getByPlaceholderText('you@example.com')).not.toBeDisabled()
      expect(screen.getByPlaceholderText('024xxxxxxx')).not.toBeDisabled()
    })

    it('shows an inline error when saving fails', async () => {
      renderPanel({ auth: makeAuth({ updateProfile: vi.fn().mockRejectedValue(new Error('nope')) }) })
      fireEvent.click(screen.getAllByText('Profile')[0])
      fireEvent.click(screen.getByText('Save Changes'))
      await screen.findByText('Could not save your profile. Please try again.')
    })
  })

  describe('Orders & Delivery tab', () => {
    it('shows an empty state when there are no orders', async () => {
      server.use(http.get('http://localhost:8000/api/orders/', () => HttpResponse.json([])))
      renderPanel()
      fireEvent.click(screen.getAllByText('Orders & Delivery')[0])
      await screen.findByText('No orders yet.')
    })

    it('shows a delivery stepper only for a paid door-to-door order', async () => {
      server.use(
        http.get('http://localhost:8000/api/orders/', () =>
          HttpResponse.json([
            {
              id: 1, status: 'paid', delivery_status: 'shipped', delivery_method: 'door_to_door', delivery_address: '12 Ash Road', total_amount: '150.00', placed_at: '2026-07-01T00:00:00Z',
              items: [{ id: 1, listing: 5, listing_name: 'Kente Cloth', quantity: 1, unit_price: '150.00', line_total: '150.00' }],
            },
            {
              id: 2, status: 'pending', delivery_status: 'processing', delivery_method: 'store_pickup', total_amount: '80.00', placed_at: '2026-07-02T00:00:00Z',
              items: [{ id: 2, listing: 6, listing_name: 'Beaded Necklace', quantity: 2, unit_price: '40.00', line_total: '80.00' }],
            },
          ]),
        ),
      )
      renderPanel()
      fireEvent.click(screen.getAllByText('Orders & Delivery')[0])
      await screen.findByText('Kente Cloth × 1')
      expect(screen.getByText('Beaded Necklace × 2')).toBeInTheDocument()
      // The stepper's "Processing" step label exists once — on order #1 (paid,
      // door-to-door). Order #2 is store pickup, which gets no shipping stepper.
      expect(screen.getAllByText('Processing').length).toBe(1)
      expect(screen.getByText('Shipped')).toBeInTheDocument()
      // The delivery method is surfaced on each order.
      expect(screen.getByText(/Door-to-door/)).toBeInTheDocument()
      expect(screen.getByText(/Store pickup/)).toBeInTheDocument()
    })
  })

  describe('Saved Businesses tab', () => {
    it('shows the empty state when there are no favourites', () => {
      renderPanel({ favourites: [] })
      fireEvent.click(screen.getAllByText('Saved Businesses')[0])
      expect(screen.getByText(/No saved businesses yet/)).toBeInTheDocument()
    })

    it('renders favourited listings via FavDrawerItem', async () => {
      server.use(
        http.get('http://localhost:8000/api/listings/5/', () =>
          HttpResponse.json({ id: 5, name: 'Royal Ashanti Lodge', price_amount: '450.00', price_unit: '/night', category: { icon: '🏨' } }),
        ),
      )
      renderPanel({ favourites: [5] })
      fireEvent.click(screen.getAllByText('Saved Businesses')[0])
      await screen.findByText('Royal Ashanti Lodge')
    })
  })

  describe('Messages tab', () => {
    it('mounts MessagingCenter, whose close control returns to the Profile tab', () => {
      // jsdom doesn't implement scrollIntoView — MessagingCenter calls it on
      // mount/conversation-change, same stub convention as ScrollSpyTabs.test.jsx.
      Element.prototype.scrollIntoView = vi.fn()
      renderPanel()
      fireEvent.click(screen.getAllByText('Messages')[0])
      expect(screen.getByText('💬 Messages')).toBeInTheDocument()
      fireEvent.click(screen.getAllByText('✕')[0])
      // Back on Profile — the name field is visible again.
      expect(screen.getByDisplayValue('Ama Boateng')).toBeInTheDocument()
    })

    // MessagingCenter is now backed by the real messaging app
    // (useMyConversations()/POST /api/messaging/conversations/(:id/messages/)?)
    // instead of the old hardcoded MOCK_CONVERSATIONS.
    it('renders a real conversation from useMyConversations with its last message', async () => {
      Element.prototype.scrollIntoView = vi.fn()
      server.use(
        http.get('http://localhost:8000/api/messaging/conversations/', () => HttpResponse.json([
          {
            id: 1, customer: 1, business_owner: null, starter_name: 'Ama Boateng', subject: 'Royal Ashanti Lodge', status: 'open',
            messages: [{ id: 1, conversation: 1, sender_type: 'staff', body: 'We checked availability for you!', created_at: '2026-07-01T10:00:00Z' }],
            created_at: '2026-07-01T09:00:00Z', updated_at: '2026-07-01T10:00:00Z',
          },
        ])),
      )
      renderPanel()
      fireEvent.click(screen.getAllByText('Messages')[0])
      await screen.findByText('We checked availability for you!')
      // "Re: Royal Ashanti Lodge" appears twice — once in the left
      // conversation-list row, once in the right chat header.
      expect(screen.getAllByText('Re: Royal Ashanti Lodge').length).toBeGreaterThan(0)
    })

    it('shows exactly one "Re:" when the stored subject already starts with "Re:"', async () => {
      // Starting a chat from a business stores subject "Re: <name>"; the UI
      // used to prefix again and render "Re: Re: <name>".
      Element.prototype.scrollIntoView = vi.fn()
      server.use(
        http.get('http://localhost:8000/api/messaging/conversations/', () => HttpResponse.json([
          {
            id: 1, customer: 1, business_owner: null, starter_name: 'Ama Boateng', subject: 'Re: Royal Ashanti Lodge', status: 'open',
            messages: [{ id: 1, conversation: 1, sender_type: 'staff', body: 'We checked availability for you!', created_at: '2026-07-01T10:00:00Z' }],
            created_at: '2026-07-01T09:00:00Z', updated_at: '2026-07-01T10:00:00Z',
          },
        ])),
      )
      renderPanel()
      fireEvent.click(screen.getAllByText('Messages')[0])
      await screen.findByText('We checked availability for you!')
      expect(screen.getAllByText('Re: Royal Ashanti Lodge').length).toBeGreaterThan(0)
      expect(screen.queryByText(/Re:\s*Re:/i)).not.toBeInTheDocument()
    })

    it('replying within an existing conversation posts to /messages/ and refetches', async () => {
      Element.prototype.scrollIntoView = vi.fn()
      let replyBody = null
      server.use(
        http.get('http://localhost:8000/api/messaging/conversations/', () => HttpResponse.json([
          {
            id: 1, customer: 1, business_owner: null, starter_name: 'Ama Boateng', subject: 'Royal Ashanti Lodge', status: 'open',
            messages: [{ id: 1, conversation: 1, sender_type: 'staff', body: 'We checked availability for you!', created_at: '2026-07-01T10:00:00Z' }],
            created_at: '2026-07-01T09:00:00Z', updated_at: '2026-07-01T10:00:00Z',
          },
        ])),
        http.post('http://localhost:8000/api/messaging/conversations/1/messages/', async ({ request }) => {
          replyBody = await request.json()
          return HttpResponse.json({ id: 2, conversation: 1, sender_type: 'customer', body: replyBody.body, created_at: '2026-07-01T11:00:00Z' }, { status: 201 })
        }),
      )
      renderPanel()
      fireEvent.click(screen.getAllByText('Messages')[0])
      await screen.findByText('We checked availability for you!')
      const input = screen.getByPlaceholderText('Type a message...')
      fireEvent.change(input, { target: { value: 'Is breakfast included?' } })
      fireEvent.click(screen.getByText('➤'))
      await waitFor(() => expect(replyBody).toEqual({ body: 'Is breakfast included?' }))
    })

    it('sending a first message with zero conversations starts a new one', async () => {
      Element.prototype.scrollIntoView = vi.fn()
      let createBody = null
      server.use(
        http.get('http://localhost:8000/api/messaging/conversations/', () => HttpResponse.json([])),
        http.post('http://localhost:8000/api/messaging/conversations/', async ({ request }) => {
          createBody = await request.json()
          return HttpResponse.json(
            { id: 9, customer: 1, business_owner: null, starter_name: 'Ama Boateng', subject: createBody.subject, status: 'open', messages: [{ id: 1, conversation: 9, sender_type: 'customer', body: createBody.body, created_at: '2026-07-01T00:00:00Z' }], created_at: '2026-07-01T00:00:00Z', updated_at: '2026-07-01T00:00:00Z' },
            { status: 201 },
          )
        }),
      )
      renderPanel()
      fireEvent.click(screen.getAllByText('Messages')[0])
      await screen.findByText(/Send a message below to start a new conversation/)
      const input = screen.getByPlaceholderText('Type a message...')
      fireEvent.change(input, { target: { value: 'Hello, I have a question.' } })
      fireEvent.click(screen.getByText('➤'))
      await waitFor(() => expect(createBody).toEqual({ subject: '', body: 'Hello, I have a question.' }))
    })
  })

  describe('My Events tab', () => {
    // My Events now mounts the same self-contained EventSubmissionPanel used
    // on the public Events page — a real submission form, not a read-only list.
    it('shows the submission toggle and an empty state with no events', async () => {
      server.use(http.get('http://localhost:8000/api/events/mine/', () => HttpResponse.json([])))
      renderPanel()
      fireEvent.click(screen.getAllByText('My Events')[0])
      expect(await screen.findByText('📅 Submit an Event')).toBeInTheDocument()
      expect(await screen.findByText("You haven't submitted any events yet.")).toBeInTheDocument()
    })

    it('renders a submitted event with its status pill', async () => {
      server.use(
        http.get('http://localhost:8000/api/events/mine/', () =>
          HttpResponse.json([{ id: 1, name: 'Akwasidae Festival', status: 'approved', event_date: '2026-08-01T10:00:00Z', category: { label: 'Culture' } }]),
        ),
      )
      renderPanel()
      fireEvent.click(screen.getAllByText('My Events')[0])
      await screen.findByText('Akwasidae Festival')
      expect(screen.getByText('approved')).toBeInTheDocument()
    })
  })

  describe('tickets and orders', () => {
    it('shows a scannable QR code beside each ticket code in My Tickets', async () => {
      server.use(http.get('http://localhost:8000/api/events/tickets/mine/', () => HttpResponse.json([{
        id: 3, code: 'ad3126f8cbc4', price: '50.00', escrow_status: 'held', delivered_at: null, refunded_at: null,
        event: { name: 'Highlife Night', event_date: '2026-12-20' }, ticket_type: { name: 'Regular' },
      }])))
      renderPanel()
      fireEvent.click(screen.getAllByText('My Tickets')[0])
      expect(await screen.findByAltText('QR code for ticket ad3126f8cbc4')).toBeInTheDocument()
    })

    it('offers "Raise a dispute" on every order', async () => {
      server.use(http.get('http://localhost:8000/api/orders/', () => HttpResponse.json([{
        id: 42, status: 'paid', placed_at: '2026-10-05T10:00:00Z', total_amount: '250.00',
        delivery_method: 'pickup', items: [{ id: 1, listing_name: 'Kente stole', quantity: 1, line_total: '250.00' }],
      }])))
      renderPanel()
      fireEvent.click(screen.getAllByText('Orders & Delivery')[0])
      expect(await screen.findByRole('button', { name: 'Raise a dispute' })).toBeInTheDocument()
    })
  })

  describe('Orders & Delivery tab — scheduled start', () => {
    const order = (extra) => ({
      id: 7, status: 'paid', placed_at: '2026-10-19T22:00:00Z', total_amount: '90.00', delivery_method: 'door_to_door', delivery_status: 'processing',
      items: [{ id: 1, listing_name: 'Shea butter', quantity: 1, line_total: '90.00' }], ...extra,
    })
    const show = async (o) => {
      server.use(http.get('http://localhost:8000/api/orders/', () => HttpResponse.json([o])))
      renderPanel()
      fireEvent.click(screen.getAllByText('Orders & Delivery')[0])
      await screen.findByText('Shea butter × 1')
    }

    it('says when delivery is scheduled to start while ready_not_before is in the future', async () => {
      await show(order({ ready_not_before: '2099-10-20T08:00:00Z' }))
      expect(screen.getByTestId('order-scheduled-start')).toHaveTextContent(/Delivery scheduled to start \w{3} 08:00/)
    })

    it('shows nothing once the time has passed', async () => {
      await show(order({ ready_not_before: '2020-10-20T08:00:00Z' }))
      expect(screen.queryByTestId('order-scheduled-start')).not.toBeInTheDocument()
    })

    it('shows nothing when ready_not_before is unset', async () => {
      await show(order({ ready_not_before: null }))
      expect(screen.queryByTestId('order-scheduled-start')).not.toBeInTheDocument()
    })

    it('shows nothing for an order that is not paid yet', async () => {
      await show(order({ status: 'pending', ready_not_before: '2099-10-20T08:00:00Z' }))
      expect(screen.queryByTestId('order-scheduled-start')).not.toBeInTheDocument()
    })

    it('shows nothing for a delivered order', async () => {
      await show(order({ ready_not_before: '2099-10-20T08:00:00Z', delivery_assignment_status: 'delivered' }))
      expect(screen.queryByTestId('order-scheduled-start')).not.toBeInTheDocument()
    })
  })

  describe('My Requests tab — terms before paying a quote', () => {
    it('shows when it can be cancelled and when the business is paid above the Pay button', async () => {
      server.use(http.get('http://localhost:8000/api/services/requests/mine/', () => HttpResponse.json([
        { id: 4, listing_name: 'Kumasi City Tour', message: 'Two adults', status: 'accepted', agreed_price: '300.00' },
      ])))
      renderPanel()
      fireEvent.click(screen.getAllByText('My Requests')[0])
      expect(await screen.findByRole('button', { name: /Pay GHS 300.00 to start/ })).toBeInTheDocument()
      expect(await screen.findByText(/any time before the business marks the job done/)).toBeInTheDocument()
      expect(screen.getByText(/accepted automatically 48 hours after the business marks it done/)).toBeInTheDocument()
    })
  })
})

describe('Account bookings and tickets — 7G', () => {
  const API = 'http://localhost:8000'
  const money = (extra = {}) => ({
    sale: 12, release_at: '2099-10-12T14:00:00Z', released_at: null, accepted_at: null, refunded: null, refunded_whole: false, problem: null,
    policy: { policy: 'moderate', tiers: [[120, 10000], [24, 5000]], text: 'Full refund until 5 days before the start, half until 24 hours before.' },
    start: '2099-10-10T14:00:00Z', can_cancel: true, can_report: true, ...extra,
  })
  const stay = (extra = {}) => ({
    id: 5, listing_name: 'Ashanti Lodge', status: 'confirmed', check_in: '2099-10-10', check_out: '2099-10-12', nights: 2, units: 1, total_price: '300.00',
    paid_at: '2026-10-01T10:00:00Z', money: money(), ...extra,
  })
  const ticket = (id, sale, eventName, extra = {}) => ({
    id, code: `TKT${id}`, price: '50.00', refunded_at: null, delivered_at: null, escrow_status: 'held',
    event: { id: 1, name: eventName, event_date: '2099-12-01' }, ticket_type: { name: 'Regular' },
    money: sale == null ? null : money({ sale, policy: { policy: 'organiser', tiers: [], text: 'The organiser sets the refund rules.' } }), ...extra,
  })
  const openBookings = async (rows) => {
    server.use(http.get(`${API}/api/bookings/mine/`, () => HttpResponse.json(rows)))
    renderPanel()
    fireEvent.click(screen.getAllByText('My Bookings')[0])
  }
  const openTickets = (rows) => {
    server.use(http.get(`${API}/api/events/tickets/mine/`, () => HttpResponse.json(rows)))
    renderPanel()
    fireEvent.click(screen.getAllByText('My Tickets')[0])
  }

  it('shows the stay policy, release time, Cancel and Report from the money block', async () => {
    await openBookings([stay()])
    expect(await screen.findByText('Moderate: Full refund until 5 days before the start, half until 24 hours before.')).toBeInTheDocument()
    expect(screen.getByText(/The host is paid on .* unless you report a problem before then\./)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel booking' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Report a problem' })).toBeInTheDocument()
  })

  it('cancels a stay with the server quote and shows the returned amount', async () => {
    let cancelled = 0
    server.use(
      http.get(`${API}/api/ledger/bookings/12/cancel-quote/`, () => HttpResponse.json({ refund: '150.00', whole: false })),
      http.post(`${API}/api/bookings/5/cancel/`, () => { cancelled += 1; return HttpResponse.json({ id: 5, wallet_refund: '140.00' }) }),
    )
    await openBookings([stay()])
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel booking' }))
    expect(await screen.findByText(/150\.00/)).toBeInTheDocument()
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Cancel this booking' })).getByRole('button', { name: 'Cancel booking' }))
    expect(await screen.findByText('Cancelled. GH₵ 140.00 went back to your AshantiHub wallet.')).toBeInTheDocument()
    expect(cancelled).toBe(1)
  })

  it('asks before cancelling with the ledger off and says no refund is made in the app', async () => {
    let cancelled = 0
    server.use(http.post(`${API}/api/bookings/5/cancel/`, () => { cancelled += 1; return HttpResponse.json({ id: 5 }) }))
    await openBookings([stay({ money: null })])
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel booking' }))
    expect(cancelled).toBe(0)
    const dialog = screen.getByRole('dialog', { name: 'Cancel this booking' })
    expect(within(dialog).getByText('No refund is made in the app. Contact AshantiHub Support about your payment.')).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel booking' }))
    await waitFor(() => expect(cancelled).toBe(1))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Cancel this booking' })).toBeNull())
  })

  it('shows the server refusal instead of a generic error', async () => {
    server.use(http.post(`${API}/api/bookings/5/cancel/`, () => HttpResponse.json({ detail: 'This booking can no longer be cancelled.' }, { status: 409 })))
    await openBookings([stay({ money: null, paid_at: null })])
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel booking' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Cancel this booking' })).getByRole('button', { name: 'Cancel booking' }))
    expect(await screen.findByText('This booking can no longer be cancelled.')).toBeInTheDocument()
    expect(screen.queryByText('Could not cancel this booking.')).toBeNull()
  })

  it('gives the tickets of one purchase one bar', async () => {
    server.use(http.get(`${API}/api/ledger/bookings/30/cancel-quote/`, () => HttpResponse.json({ refund: '100.00', whole: true })))
    openTickets([ticket(1, 30, 'Kente Night'), ticket(2, 30, 'Kente Night'), ticket(3, 31, 'Jazz Evening')])
    expect(await screen.findAllByRole('button', { name: 'Cancel tickets' })).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: 'Report a problem' })).toHaveLength(2)
    fireEvent.click(screen.getAllByRole('button', { name: 'Cancel tickets' })[0])
    expect(await screen.findByText('Cancel all 2 tickets in this purchase?')).toBeInTheDocument()
  })

  it('keeps a purchase together when searching', async () => {
    openTickets([ticket(1, 30, 'Kente Night'), ticket(2, 30, 'Kente Night', { code: 'ZZZ-SPECIAL' }), ticket(3, 31, 'Jazz Evening')])
    await screen.findAllByRole('button', { name: 'Cancel tickets' })
    fireEvent.change(screen.getByPlaceholderText('Search tickets…'), { target: { value: 'zzz-special' } })
    expect(screen.getByText('TKT1')).toBeInTheDocument()
    expect(screen.getByText('ZZZ-SPECIAL')).toBeInTheDocument()
    expect(screen.queryByText('TKT3')).toBeNull()
    expect(screen.getAllByRole('button', { name: 'Cancel tickets' })).toHaveLength(1)
  })

  it('shows no bar for a ticket without money', async () => {
    openTickets([ticket(1, null, 'Kente Night')])
    expect(await screen.findByText('TKT1')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancel tickets' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Report a problem' })).toBeNull()
  })

  it('opens Messages about the listing from Contact AshantiHub Support', async () => {
    Element.prototype.scrollIntoView = vi.fn()
    await openBookings([stay({ money: money({ policy: null, can_cancel: false, can_report: false }) })])
    fireEvent.click(await screen.findByRole('button', { name: 'Contact AshantiHub Support' }))
    expect(await screen.findByText(/start a new conversation about Ashanti Lodge/)).toBeInTheDocument()
  })
})
