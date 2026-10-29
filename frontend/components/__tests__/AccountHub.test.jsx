import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { UserPanel } from '../../App.jsx'
import AccountHub from '../account/AccountHub.jsx'

const TILES = [
  ['Your Orders', '/my-account/orders'],
  ['Login & security', '/my-account/security'],
  ['Your Addresses', '/my-account/addresses'],
  ['Your Payments', '/my-account/payments/overview'],
  ['Your Lists', '/my-account/lists'],
  ['Customer Service', '/my-account/help'],
  ['Your Messages', '/my-account/messages'],
  ['Sell on AshantiHub', '/my-account/sell'],
]

function Probe() {
  const l = useLocation()
  const nav = useNavigate()
  return (
    <div>
      <div data-testid="loc">{l.pathname}</div>
      <button type="button" onClick={() => nav(-1)}>history back</button>
    </div>
  )
}

const slots = {
  overview: () => <div>overview-stub</div>,
  orders: () => <div>orders-stub</div>,
  bookings: () => <div>bookings-stub</div>,
  requests: () => <div>requests-stub</div>,
  tickets: () => <div>tickets-stub</div>,
  events: () => <div>events-stub</div>,
  saved: () => <div>saved-stub</div>,
  settings: () => <div>settings-stub</div>,
  profile: () => <div>profile-stub</div>,
  messages: () => <div>messages-stub</div>,
}

function renderHub(path = '/my-account', props = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <AccountHub
          user={{ fullName: 'Ama Boateng', accountType: 'customer', id: 1, email: 'ama@example.com', phone: '0244000111' }}
          auth={{ requestPasswordReset: vi.fn().mockResolvedValue({}) }}
          render={slots}
          onContactSupport={vi.fn()}
          onRegisterBusiness={vi.fn()}
          {...props}
        />
        <Probe />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('AccountHub tiles', () => {
  it('test_hub_shows_exactly_the_eight_tiles_in_order', () => {
    renderHub()
    const titles = screen.getAllByTestId('account-tile').map((t) => within(t).getByRole('heading').textContent)
    expect(titles).toEqual(TILES.map(([t]) => t))
  })

  it('test_no_prime_gift_card_family_or_digital_tiles', () => {
    renderHub()
    for (const word of [/prime/i, /gift card/i, /family/i, /digital services/i, /^manage/i]) {
      expect(screen.queryByText(word)).not.toBeInTheDocument()
    }
  })

  it.each(TILES)('test_each_tile_navigates_to_its_section_url: %s', (title, path) => {
    renderHub()
    fireEvent.click(screen.getByRole('link', { name: new RegExp(title.replace('&', '&'), 'i') }))
    expect(screen.getByTestId('loc')).toHaveTextContent(path)
  })

  it('an unknown section falls back to the hub, never a blank page', () => {
    renderHub('/my-account/nonsense')
    expect(screen.getAllByTestId('account-tile')).toHaveLength(8)
  })
})

describe('AccountHub sections', () => {
  it('shows a breadcrumb back to Your Account', () => {
    renderHub('/my-account/lists')
    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' })
    expect(crumbs).toHaveTextContent('Your Account')
    expect(crumbs).toHaveTextContent('Your Lists')
    fireEvent.click(within(crumbs).getByRole('link', { name: 'Your Account' }))
    expect(screen.getByTestId('loc')).toHaveTextContent(/^\/my-account$/)
  })

  it('test_orders_tabs_still_reach_bookings_requests_tickets_events', () => {
    renderHub('/my-account/orders')
    expect(screen.getByText('orders-stub')).toBeInTheDocument()
    ;[['Bookings', 'bookings-stub'], ['Service requests', 'requests-stub'], ['Tickets', 'tickets-stub'], ['My events', 'events-stub']].forEach(([tab, stub]) => {
      fireEvent.click(screen.getByRole('tab', { name: tab }))
      expect(screen.getByText(stub)).toBeInTheDocument()
    })
  })

  it('test_deep_link_to_payments_wallet_opens_that_tab', () => {
    renderHub('/my-account/payments/wallet')
    expect(screen.getByRole('tab', { name: 'Wallet' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('This part of Your Payments is not available yet.')).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toHaveTextContent('Your Account')
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toHaveTextContent('Your Payments')
  })

  it('moving between payments tabs changes the URL', () => {
    renderHub('/my-account/payments/overview')
    fireEvent.click(screen.getByRole('tab', { name: 'Transactions' }))
    expect(screen.getByTestId('loc')).toHaveTextContent('/my-account/payments/transactions')
  })

  it('test_back_button_returns_to_the_previous_section', () => {
    renderHub('/my-account')
    fireEvent.click(screen.getByRole('link', { name: /Your Lists/i }))
    expect(screen.getByText('saved-stub')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'history back' }))
    expect(screen.getByTestId('loc')).toHaveTextContent(/^\/my-account$/)
    expect(screen.getAllByTestId('account-tile')).toHaveLength(8)
  })

  it('test_customer_service_has_no_phone_numbers', () => {
    const onContactSupport = vi.fn()
    renderHub('/my-account/help', { onContactSupport })
    expect(document.body.textContent).not.toMatch(/\+?\d[\d\s-]{8,}\d/)
    expect(document.querySelector('a[href^="tel:"], a[href*="wa.me"]')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Contact Support/ }))
    expect(onContactSupport).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Report a problem with an order' }))
    expect(screen.getByTestId('loc')).toHaveTextContent('/my-account/orders')
  })

  it('Customer Service links to the FAQ and Contact page through the app', () => {
    const onOpenPage = vi.fn()
    renderHub('/my-account/help', { onOpenPage })
    fireEvent.click(screen.getByRole('button', { name: 'Read the FAQ' }))
    expect(onOpenPage).toHaveBeenCalledWith('about')
    fireEvent.click(screen.getByRole('button', { name: 'Contact page' }))
    expect(onOpenPage).toHaveBeenCalledWith('contact')
  })

  it('Sell on AshantiHub offers the existing business registration', () => {
    const onRegisterBusiness = vi.fn()
    renderHub('/my-account/sell', { onRegisterBusiness })
    fireEvent.click(screen.getByRole('button', { name: /Register your business/ }))
    expect(onRegisterBusiness).toHaveBeenCalledTimes(1)
  })

  it('Login & security lists name, email, mobile and password, with no passkey row', () => {
    renderHub('/my-account/security')
    for (const label of ['Name', 'Email', 'Primary mobile number', 'Password']) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
    expect(screen.getByText('ama@example.com')).toBeInTheDocument()
    expect(screen.queryByText(/passkey/i)).not.toBeInTheDocument()
    // everything the old Profile and Settings tabs held stays reachable
    expect(screen.getByText('profile-stub')).toBeInTheDocument()
    expect(screen.getByText('settings-stub')).toBeInTheDocument()
  })

  it('Password reset by email uses the existing reset call and says so plainly', async () => {
    const requestPasswordReset = vi.fn().mockResolvedValue({})
    renderHub('/my-account/security', { auth: { requestPasswordReset } })
    fireEvent.click(screen.getByRole('button', { name: 'Reset by email' }))
    expect(await screen.findByText(/we have sent a reset link/i)).toBeInTheDocument()
    expect(requestPasswordReset).toHaveBeenCalledWith('ama@example.com')
  })
})

describe('UserPanel gates and messages', () => {
  function renderPanel(user, path = '/my-account', auth = {}) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[path]}>
          <UserPanel user={user} auth={{ ...auth }} favourites={[]} toggleFav={vi.fn()} onExit={vi.fn()} />
        </MemoryRouter>
      </QueryClientProvider>,
    )
  }

  it('test_signed_out_and_business_owner_see_the_customer_gate', () => {
    const { unmount } = renderPanel(null)
    expect(screen.getByText(/Sign in with a customer account/)).toBeInTheDocument()
    unmount()
    renderPanel({ fullName: 'Kofi', accountType: 'business_owner', id: 2 })
    expect(screen.getByText(/Sign in with a customer account/)).toBeInTheDocument()
    expect(screen.queryByTestId('account-tile')).not.toBeInTheDocument()
  })

  it('the loading gate shows Loading and no tiles', () => {
    renderPanel({ fullName: 'Ama', accountType: 'customer', id: 1 }, '/my-account', { isLoading: true })
    expect(screen.getByText('Loading…')).toBeInTheDocument()
    expect(screen.queryByTestId('account-tile')).not.toBeInTheDocument()
  })

  it('test_messages_has_no_third_party_sellers_tab', async () => {
    Element.prototype.scrollIntoView = vi.fn()
    renderPanel({ fullName: 'Ama', accountType: 'customer', id: 1 }, '/my-account/messages')
    expect(screen.getByRole('heading', { name: 'Your Messages' })).toBeInTheDocument()
    expect(screen.getByText('Messages with AshantiHub Support')).toBeInTheDocument()
    expect(screen.queryByText(/sellers/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: /email|text|phone/i })).not.toBeInTheDocument()
  })
})
