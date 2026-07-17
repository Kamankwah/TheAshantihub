import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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
})
