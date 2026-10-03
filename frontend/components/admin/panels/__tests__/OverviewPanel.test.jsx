import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { server } from '../../../../mocks/server.js'
import OverviewPanel from '../OverviewPanel.jsx'

// The dispatch and delivery_manager roles used to get a greeting-only
// Overview. Their tiles are built only from the endpoints their own panels
// already read (GET /api/orders/dispatch/ — delivery.dispatch; GET
// /api/orders/delivery/ + /api/orders/dispatches/ — delivery.manage), with
// the backends' real shapes: both lists are DRF-paginated (page_size 20),
// /dispatches/ is a plain array of {id, full_name}.

const NOW = new Date().toISOString()
const DAYS_AGO = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()

function makeAuth(role, perms) {
  return {
    user: { token: 't', account_type: 'staff', id: 5, full_name: 'Kofi Rider', role, permissions: perms },
    hasPermission: (c) => perms.includes(c),
  }
}

function renderOverview(auth, onNavigate = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <OverviewPanel auth={auth} roleColor="#E8621A" onNavigate={onNavigate} />
    </QueryClientProvider>,
  )
  return onNavigate
}

// KpiCard renders the value immediately above its label.
function tileValue(label) {
  return screen.getByText(label).previousSibling.textContent
}

function delivery(id, status, extra = {}) {
  return {
    id, order_id: 100 + id, status, customer_name: `Customer ${id}`,
    delivery_address: `${id} Ash Road`, delivery_phone: '+233200000000',
    delivery_lat: null, delivery_lng: null, pickups: [],
    assigned_at: DAYS_AGO, picked_up_at: null, delivered_at: null, confirmed_at: null,
    ...extra,
  }
}

function order(id, assignment) {
  return {
    id, customer_name: `Buyer ${id}`, status: 'paid', delivery_status: 'processing',
    placed_at: DAYS_AGO, items: [], total_amount: '10.00',
    delivery_address: `${id} Road`, delivery_phone: '+233200000000',
    delivery_assignment: assignment,
  }
}

function assignment(status, extra = {}) {
  return {
    id: 1, dispatch: 9, dispatch_name: 'Dispatch Kofi', status, notes: '',
    assigned_at: DAYS_AGO, picked_up_at: null, delivered_at: null, confirmed_at: null, ...extra,
  }
}

const dispatchAuth = () => makeAuth('dispatch', ['delivery.dispatch'])
const managerAuth = () => makeAuth('delivery_manager', ['delivery.manage'])

describe('OverviewPanel — dispatch', () => {
  it('derives the tiles from the returned rows and lists up to 3 actionable deliveries', async () => {
    server.use(http.get('http://localhost:8000/api/orders/dispatch/', () => HttpResponse.json({
      count: 6, next: null, previous: null, results: [
        delivery(1, 'assigned'),
        delivery(2, 'picked_up', { picked_up_at: NOW }),
        delivery(3, 'assigned'),
        delivery(4, 'assigned'),
        delivery(5, 'delivered', { delivered_at: NOW }),
        delivery(6, 'confirmed', { delivered_at: DAYS_AGO, confirmed_at: DAYS_AGO }),
      ],
    })))
    renderOverview(dispatchAuth())
    await screen.findByText('Assigned to me')
    expect(tileValue('Assigned to me')).toBe('6')
    expect(tileValue('Awaiting pickup')).toBe('3')
    expect(tileValue('Out for delivery')).toBe('1')
    expect(tileValue('Delivered today')).toBe('1')
    // Next up: only actionable (assigned / picked up), at most 3.
    const nextUp = screen.getByRole('list', { name: 'Next up' })
    expect(nextUp.querySelectorAll('li')).toHaveLength(3)
    expect(screen.queryByText(/Order #105/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Order #106/)).not.toBeInTheDocument()
    expect(screen.queryByText(/newest/)).not.toBeInTheDocument()
  })

  it('opens My Deliveries through the navigation callback', async () => {
    server.use(http.get('http://localhost:8000/api/orders/dispatch/', () => HttpResponse.json({
      count: 1, next: null, previous: null, results: [delivery(1, 'assigned')],
    })))
    const onNavigate = renderOverview(dispatchAuth())
    fireEvent.click(await screen.findByRole('button', { name: /Open My Deliveries/ }))
    expect(onNavigate).toHaveBeenCalledWith('my-deliveries')
  })

  it('uses the paginated count as the total and says the breakdown covers only the first page', async () => {
    server.use(http.get('http://localhost:8000/api/orders/dispatch/', () => HttpResponse.json({
      count: 45, next: 'http://localhost:8000/api/orders/dispatch/?page=2', previous: null,
      results: [delivery(1, 'assigned'), delivery(2, 'picked_up')],
    })))
    renderOverview(dispatchAuth())
    await screen.findByText('Assigned to me')
    expect(tileValue('Assigned to me')).toBe('45')
    expect(screen.getAllByText(/newest 2 of 45/).length).toBeGreaterThan(0)
  })

  it('shows an honest empty state and no zero tiles when nothing is assigned', async () => {
    renderOverview(dispatchAuth())
    expect(await screen.findByText('No deliveries assigned to you yet.')).toBeInTheDocument()
    expect(screen.queryByText('Awaiting pickup')).not.toBeInTheDocument()
    expect(screen.queryByText('Delivered today')).not.toBeInTheDocument()
    // The way into the panel is still there.
    expect(screen.getByRole('button', { name: /Open My Deliveries/ })).toBeInTheDocument()
  })

  it('says so when the deliveries cannot be loaded', async () => {
    server.use(http.get('http://localhost:8000/api/orders/dispatch/', () => HttpResponse.json({ detail: 'x' }, { status: 500 })))
    renderOverview(dispatchAuth())
    expect(await screen.findByText('Could not load your deliveries.')).toBeInTheDocument()
    expect(screen.queryByText('Assigned to me')).not.toBeInTheDocument()
  })
})

describe('OverviewPanel — delivery manager', () => {
  it('derives queue tiles from the returned rows plus the active dispatch count', async () => {
    server.use(
      http.get('http://localhost:8000/api/orders/delivery/', () => HttpResponse.json({
        count: 5, next: null, previous: null, results: [
          order(1, null),
          order(2, assignment('assigned')),
          order(3, assignment('picked_up', { picked_up_at: NOW })),
          order(4, assignment('delivered', { delivered_at: NOW })),
          order(5, assignment('confirmed', { delivered_at: DAYS_AGO, confirmed_at: DAYS_AGO })),
        ],
      })),
      http.get('http://localhost:8000/api/orders/dispatches/', () => HttpResponse.json([
        { id: 9, full_name: 'Dispatch Kofi' }, { id: 10, full_name: 'Dispatch Ama' }, { id: 11, full_name: 'Dispatch Yaw' },
      ])),
    )
    renderOverview(managerAuth())
    await screen.findByText('Door-to-door orders')
    expect(tileValue('Door-to-door orders')).toBe('5')
    expect(tileValue('Unassigned')).toBe('1')
    expect(tileValue('Awaiting pickup')).toBe('1')
    expect(tileValue('In transit')).toBe('1')
    expect(tileValue('Delivered today')).toBe('1')
    await waitFor(() => expect(tileValue('Active dispatch riders')).toBe('3'))
  })

  it('opens Delivery Coordination through the navigation callback', async () => {
    const onNavigate = renderOverview(managerAuth())
    fireEvent.click(await screen.findByRole('button', { name: /Open Delivery Coordination/ }))
    expect(onNavigate).toHaveBeenCalledWith('delivery-coordination')
  })

  it('shows an honest empty state and no zero queue tiles when the queue is empty', async () => {
    renderOverview(managerAuth())
    expect(await screen.findByText('No door-to-door orders to coordinate right now.')).toBeInTheDocument()
    expect(screen.queryByText('Unassigned')).not.toBeInTheDocument()
    expect(screen.queryByText('In transit')).not.toBeInTheDocument()
  })

  it('leaves the rider tile out when the dispatch list cannot be loaded', async () => {
    server.use(
      http.get('http://localhost:8000/api/orders/delivery/', () => HttpResponse.json({
        count: 1, next: null, previous: null, results: [order(1, null)],
      })),
      http.get('http://localhost:8000/api/orders/dispatches/', () => HttpResponse.json({ detail: 'x' }, { status: 500 })),
    )
    renderOverview(managerAuth())
    await screen.findByText('Unassigned')
    await new Promise(r => setTimeout(r, 50))
    expect(screen.queryByText('Active dispatch riders')).not.toBeInTheDocument()
  })

  it('a session without delivery permissions gets neither delivery section', () => {
    renderOverview(makeAuth('support', ['messaging.manage']))
    expect(screen.queryByRole('button', { name: /Open My Deliveries/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Open Delivery Coordination/ })).not.toBeInTheDocument()
  })
})
