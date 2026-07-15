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
  it('renders all 5 nav tabs and defaults to the Profile tab', () => {
    renderPanel()
    ;['Profile', 'Orders & Delivery', 'Saved Businesses', 'Messages', 'My Events'].forEach((label) => {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0)
    })
    // Profile tab content (the name field, seeded from user.fullName) is visible by default.
    expect(screen.getByDisplayValue('Ama Boateng')).toBeInTheDocument()
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
      fireEvent.change(screen.getByDisplayValue('Ama Boateng'), { target: { value: 'Ama Owusu' } })
      fireEvent.click(screen.getByText('Save'))
      await waitFor(() => expect(updateProfile).toHaveBeenCalledWith({ full_name: 'Ama Owusu', avatar: null }))
      await waitFor(() => expect(refreshUser).toHaveBeenCalledTimes(1))
      await screen.findByText('✓ Saved!')
    })

    it('does not render email or phone fields', () => {
      renderPanel()
      expect(screen.queryByText(/email/i)).not.toBeInTheDocument()
      expect(screen.queryByText(/phone/i)).not.toBeInTheDocument()
    })

    it('shows an inline error when saving fails', async () => {
      renderPanel({ auth: makeAuth({ updateProfile: vi.fn().mockRejectedValue(new Error('nope')) }) })
      fireEvent.click(screen.getByText('Save'))
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

    it('renders order items/total and shows a delivery stepper only for paid orders', async () => {
      server.use(
        http.get('http://localhost:8000/api/orders/', () =>
          HttpResponse.json([
            {
              id: 1, status: 'paid', delivery_status: 'shipped', total_amount: '150.00', placed_at: '2026-07-01T00:00:00Z',
              items: [{ id: 1, listing: 5, listing_name: 'Kente Cloth', quantity: 1, unit_price: '150.00', line_total: '150.00' }],
            },
            {
              id: 2, status: 'pending', delivery_status: 'processing', total_amount: '80.00', placed_at: '2026-07-02T00:00:00Z',
              items: [{ id: 2, listing: 6, listing_name: 'Beaded Necklace', quantity: 2, unit_price: '40.00', line_total: '80.00' }],
            },
          ]),
        ),
      )
      renderPanel()
      fireEvent.click(screen.getAllByText('Orders & Delivery')[0])
      await screen.findByText('Kente Cloth × 1')
      expect(screen.getByText('Beaded Necklace × 2')).toBeInTheDocument()
      // The delivery stepper's "Processing" step label only exists once — on
      // order #1 (paid); order #2 (pending) gets no stepper at all.
      expect(screen.getAllByText('Processing').length).toBe(1)
      expect(screen.getByText('Shipped')).toBeInTheDocument()
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
  })

  describe('My Events tab', () => {
    it('shows the "coming soon" note and an empty state with no events', async () => {
      server.use(http.get('http://localhost:8000/api/events/mine/', () => HttpResponse.json([])))
      renderPanel()
      fireEvent.click(screen.getAllByText('My Events')[0])
      await screen.findByText(/Attending history & tickets coming soon/)
      expect(screen.getByText("You haven't submitted any events yet.")).toBeInTheDocument()
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
      expect(screen.getByText('Approved')).toBeInTheDocument()
    })
  })
})
