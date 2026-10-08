import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { useRef } from 'react'
import { MemoryRouter, useLocation, useNavigationType } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AshantiHub from './App.jsx'
import { setStoredAuth } from './apiClient.js'
import { server } from './mocks/server.js'

// Staff platform phase 0: a real staff Sign out, a staff-only /staff, and a
// view-only marketplace for a staff session. Mounts the real AshantiHub
// inside a MemoryRouter (same approach as App.routing.test.jsx). Marketplace
// pages sit behind the ~1.8s simulated boot screen, hence the generous
// findBy timeouts.

const STAFF_NOTICE = "Staff accounts can't shop or sell. Sign out first."

// Records every pathname the router passes through, so a test can prove a
// flow never bounced through "/" on its way somewhere else.
function LocationProbe({ visited }) {
  const location = useLocation()
  const navigationType = useNavigationType()
  const last = useRef(null)
  if (last.current !== location.key) {
    last.current = location.key
    visited?.push(location.pathname)
  }
  return (
    <>
      <div data-testid="location">{location.pathname}</div>
      <div data-testid="navigation-type">{navigationType}</div>
    </>
  )
}

function renderAt(path, { visited, queryClient } = {}) {
  const client = queryClient ?? new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <AshantiHub />
        <LocationProbe visited={visited} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function signInStaff(permissions = ['messaging.manage', 'users.view']) {
  setStoredAuth({ token: 'test-token', account_type: 'staff', id: 1, full_name: 'Akosua Support' })
  server.use(
    http.get('http://localhost:8000/api/accounts/me/', () => HttpResponse.json({
      account_type: 'staff', id: 1, full_name: 'Akosua Support', role: 'support', permissions,
    })),
  )
}

function signInCustomer() {
  setStoredAuth({ token: 'test-token', account_type: 'customer', id: 2, full_name: 'Ama Buyer' })
  server.use(
    http.get('http://localhost:8000/api/accounts/me/', () => HttpResponse.json({
      account_type: 'customer', id: 2, full_name: 'Ama Buyer',
    })),
  )
}

const staffNav = () => screen.findByRole('navigation', { name: 'Staff panels' }, { timeout: 3000 })
const viewOnlyBar = (options) => screen.findByRole('region', { name: 'Staff session, view only' }, options)
const location = () => screen.getByTestId('location').textContent

afterEach(() => setStoredAuth(null))

describe('Staff Sign out in the browser', () => {
  it('clears the cache, signs out and lands on /staff (replacing /staff/users) with the staff sign-in — never "/"', async () => {
    signInStaff()
    const visited = []
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const clearSpy = vi.spyOn(queryClient, 'clear')
    renderAt('/staff/users', { visited, queryClient })
    await staffNav()

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(clearSpy).toHaveBeenCalled()
    expect(await screen.findByText('Staff Sign In', {}, { timeout: 3000 })).toBeInTheDocument()
    expect(location()).toBe('/staff')
    expect(screen.getByTestId('navigation-type').textContent).toBe('REPLACE')
    expect(visited).not.toContain('/')
    expect(screen.queryByRole('navigation', { name: 'Staff panels' })).not.toBeInTheDocument()
  }, 10000)
})

describe('/staff is staff-only in the browser', () => {
  it('a signed-out visit shows a staff sign-in that neither ✕ nor the backdrop can dismiss', async () => {
    renderAt('/staff')
    expect(await screen.findByText('Staff Sign In', {}, { timeout: 3000 })).toBeInTheDocument()
    fireEvent.click(within(screen.getByTestId('auth-modal-backdrop')).getByRole('button', { name: '✕' }))
    await waitFor(() => expect(screen.getByText('Staff Sign In')).toBeInTheDocument())
    fireEvent.click(screen.getByTestId('auth-modal-backdrop'))
    await waitFor(() => expect(screen.getByText('Staff Sign In')).toBeInTheDocument())
    expect(location()).toBe('/staff')
  }, 10000)

  it('a signed-in customer on /staff/users gets the same undismissable staff sign-in', async () => {
    signInCustomer()
    renderAt('/staff/users')
    expect(await screen.findByText('Staff Sign In', {}, { timeout: 3000 })).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('auth-modal-backdrop'))
    await waitFor(() => expect(screen.getByText('Staff Sign In')).toBeInTheDocument())
  }, 10000)

  it('"Go to marketplace" is the one way out, to the marketplace home', async () => {
    renderAt('/staff')
    expect(await screen.findByText('Staff Sign In', {}, { timeout: 3000 })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Go to marketplace' }))
    await waitFor(() => expect(location()).toBe('/'))
    await waitFor(() => expect(screen.queryByText('Staff Sign In')).not.toBeInTheDocument())
  }, 10000)
})

describe('View site and the view-only bar', () => {
  it('View site keeps the staff session on "/" behind the view-only bar; Back to dashboard returns to /staff', async () => {
    signInStaff()
    renderAt('/staff/users')
    await staffNav()
    // The dashboard itself never shows the marketplace bar.
    expect(screen.queryByRole('region', { name: 'Staff session, view only' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'View site' }))
    await waitFor(() => expect(location()).toBe('/'))
    const bar = await viewOnlyBar({ timeout: 3000 })
    expect(within(bar).getByText('Staff session · view only')).toBeInTheDocument()

    fireEvent.click(within(bar).getByRole('button', { name: 'Back to dashboard' }))
    await waitFor(() => expect(location()).toBe('/staff'))
    expect(await staffNav()).toBeInTheDocument()
  }, 10000)

  it('the bar\'s Sign out clears the cache and lands on /staff with the staff sign-in', async () => {
    signInStaff()
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const clearSpy = vi.spyOn(queryClient, 'clear')
    renderAt('/business', { queryClient })
    const bar = await viewOnlyBar({ timeout: 3000 })

    fireEvent.click(within(bar).getByRole('button', { name: 'Sign out' }))
    expect(clearSpy).toHaveBeenCalled()
    await waitFor(() => expect(location()).toBe('/staff'))
    expect(await screen.findByText('Staff Sign In', {}, { timeout: 3000 })).toBeInTheDocument()
  }, 10000)

  it('is never shown to a guest', async () => {
    renderAt('/business')
    await screen.findByText(/business contact is handled by AshantiHub Support/i, {}, { timeout: 3000 })
    expect(screen.queryByRole('region', { name: 'Staff session, view only' })).not.toBeInTheDocument()
  }, 10000)

  it('is never shown to a customer', async () => {
    signInCustomer()
    renderAt('/business')
    await screen.findByText(/business contact is handled by AshantiHub Support/i, {}, { timeout: 3000 })
    expect(screen.queryByRole('region', { name: 'Staff session, view only' })).not.toBeInTheDocument()
  }, 10000)
})

describe('marketplace sell/create actions are gated for a staff session', () => {
  it('"Register Your Business" shows the staff notice instead of opening registration', async () => {
    signInStaff()
    renderAt('/business')
    fireEvent.click(await screen.findByRole('button', { name: 'Register Your Business →' }, { timeout: 3000 }))
    expect(await screen.findByText(STAFF_NOTICE)).toBeInTheDocument()
    expect(location()).toBe('/business')
  }, 10000)

  it('a staff visit straight to /register shows the staff notice, not the registration flow', async () => {
    signInStaff()
    // While the session restores, /register briefly renders the guest
    // registration flow (pre-existing, same as for a customer), which asks
    // the public plans endpoint.
    server.use(http.get('http://localhost:8000/api/billing/plans/', () => HttpResponse.json([])))
    renderAt('/register')
    expect(await screen.findByText(STAFF_NOTICE, {}, { timeout: 3000 })).toBeInTheDocument()
    expect(screen.queryByText(/Sign out & register a business/i)).not.toBeInTheDocument()
  }, 10000)

  it('"Submit an Event" shows the staff notice and does not open the submission form', async () => {
    signInStaff()
    renderAt('/events')
    fireEvent.click(await screen.findByRole('button', { name: '📅 Submit an Event' }, { timeout: 3000 }))
    expect(await screen.findByText(STAFF_NOTICE)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '✕ Close' })).not.toBeInTheDocument()
  }, 10000)
})

describe('Staff Sign out is recorded', () => {
  it('posts to /api/accounts/staff/logout/ with the staff token before clearing it', async () => {
    let authHeader = null
    server.use(http.post('http://localhost:8000/api/accounts/staff/logout/', ({ request }) => {
      authHeader = request.headers.get('Authorization')
      return new HttpResponse(null, { status: 204 })
    }))
    signInStaff()
    renderAt('/staff/users')
    await staffNav()
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    await waitFor(() => expect(authHeader).toBe('Bearer test-token'))
  }, 10000)
})
