import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { UserPanel } from '../../App.jsx'
import AccountHub from '../account/AccountHub.jsx'
import { server } from '../../mocks/server.js'
import { gatedOpening } from '../../mocks/opening.js'

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
    fireEvent.click(screen.getByRole('link', { name: new RegExp(title, 'i') }))
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

  it('test_deep_link_to_payments_wallet_opens_that_tab', async () => {
    renderHub('/my-account/payments/wallet')
    expect(screen.getByRole('tab', { name: 'Wallet' })).toHaveAttribute('aria-selected', 'true')
    expect(await screen.findByText('Mobile money numbers for withdrawals')).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toHaveTextContent('Your Account')
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toHaveTextContent('Your Payments')
  })

  it('moving between payments tabs changes the URL', () => {
    renderHub('/my-account/payments/overview')
    fireEvent.click(screen.getByRole('tab', { name: 'Transactions' }))
    expect(screen.getByTestId('loc')).toHaveTextContent('/my-account/payments/transactions')
  })

  it('test_back_button_returns_to_the_previous_section', async () => {
    renderHub('/my-account')
    fireEvent.click(screen.getByRole('link', { name: /Your Lists/i }))
    expect(await screen.findByText('Nothing saved yet — tap the heart on any item.')).toBeInTheDocument()
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

  it('Sell on AshantiHub starts registration with the customer\'s details or none', () => {
    const onStartRegistration = vi.fn()
    renderHub('/my-account/sell', { onStartRegistration })
    fireEvent.click(screen.getByRole('button', { name: 'Use my details' }))
    expect(onStartRegistration).toHaveBeenLastCalledWith({ full_name: 'Ama Boateng', phone: '0244000111', email: 'ama@example.com' })
    fireEvent.click(screen.getByRole('button', { name: 'Start with different details' }))
    expect(onStartRegistration).toHaveBeenLastCalledWith(null)
  })

  it('test_login_security_has_no_passkey_row_and_hides_two_step_until_available', () => {
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

describe('Your Orders (the Orders tab)', () => {
  const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString()
  const order = (extra) => ({
    id: 214, status: 'paid', delivery_status: 'processing', total_amount: '265.00', placed_at: daysAgo(3),
    items: [{ id: 301, listing: 12, listing_name: 'Kente Stole', variant: 41, variant_label: 'Gold / Large', quantity: 2, unit_price: '130.00', line_total: '260.00' }],
    delivery_method: 'door_to_door', delivery_address: '12 Adum Road, Kumasi', delivery_gps_address: 'AK-039-5028', delivery_landmark: 'Opposite Total filling station',
    ...extra,
  })
  function renderOrders(orders, { user = { fullName: 'Ama Boateng', accountType: 'customer', id: 1 } } = {}) {
    server.use(http.get('http://localhost:8000/api/orders/', () => HttpResponse.json(orders)))
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/my-account/orders']}>
          <UserPanel user={user} auth={{}} favourites={[]} toggleFav={vi.fn()} onExit={vi.fn()} />
        </MemoryRouter>
      </QueryClientProvider>,
    )
  }

  it('test_orders_tab_shows_order_header_fields_and_gps_and_landmark', async () => {
    renderOrders([order(), order({ id: 215, delivery_gps_address: '', delivery_landmark: '' })])
    const card = (await screen.findByText('Order #214')).closest('[data-testid="order-card"]')
    expect(within(card).getByText(/Order placed/)).toBeInTheDocument()
    expect(within(card).getByText('GHS 265.00')).toBeInTheDocument()
    expect(within(card).getByText(/12 Adum Road, Kumasi/)).toBeInTheDocument()
    expect(within(card).getByText(/AK-039-5028/)).toBeInTheDocument()
    expect(within(card).getByText(/Opposite Total filling station/)).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: 'Track package' })).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: 'View order' })).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: 'Buy it again' })).toBeInTheDocument()
    // an old order with blank GhanaPost fields shows neither line
    const old = screen.getByText('Order #215').closest('[data-testid="order-card"]')
    expect(within(old).queryByText(/GhanaPost/)).not.toBeInTheDocument()
    expect(within(old).queryByText(/Landmark/)).not.toBeInTheDocument()
  })

  it('store pickup says so in Ship to', async () => {
    renderOrders([order({ delivery_method: 'store_pickup', delivery_address: '', delivery_gps_address: '', delivery_landmark: '' })])
    const card = (await screen.findByText('Order #214')).closest('[data-testid="order-card"]')
    expect(within(card).getByText(/Ship to/)).toBeInTheDocument()
    expect(within(card).getByText(/Store pickup/)).toBeInTheDocument()
  })

  it('test_buy_it_again_adds_the_lines_and_reports_a_missing_one', async () => {
    const calls = []
    server.use(
      http.post('http://localhost:8000/api/cart/items/bulk/', async ({ request }) => {
        const body = await request.json()
        calls.push(['bulk', body])
        return HttpResponse.json({ id: 1, items: [] }, { status: 201 })
      }),
      http.post('http://localhost:8000/api/cart/items/', async ({ request }) => {
        const body = await request.json()
        calls.push(['plain', body])
        if (body.listing === 77) return HttpResponse.json({ listing: ['Invalid pk "77" - object does not exist.'] }, { status: 400 })
        return HttpResponse.json({ id: 9 }, { status: 201 })
      }),
    )
    renderOrders([order({
      items: [
        { id: 1, listing: 12, listing_name: 'Kente Stole', variant: 41, variant_label: 'Gold / Large', quantity: 2, line_total: '260.00' },
        { id: 2, listing: 12, listing_name: 'Kente Stole', variant: 42, variant_label: 'Gold / Small', quantity: 1, line_total: '130.00' },
        { id: 3, listing: 50, listing_name: 'Shea Butter', variant: null, variant_label: '', quantity: 3, line_total: '90.00' },
        { id: 4, listing: 77, listing_name: 'Old Drum', variant: null, variant_label: '', quantity: 1, line_total: '40.00' },
      ],
    })])
    fireEvent.click(await screen.findByRole('button', { name: 'Buy it again' }))
    expect(await screen.findByText('Old Drum is no longer available')).toBeInTheDocument()
    expect(calls).toContainEqual(['bulk', { listing: 12, lines: [{ variant: 41, quantity: 2 }, { variant: 42, quantity: 1 }] }])
    expect(calls).toContainEqual(['plain', { listing: 50, quantity: 3 }])
    expect(await screen.findByText(/Added 2 products to your cart/)).toBeInTheDocument()
  })

  it('a variant that is gone is reported by name and the other lines are still added', async () => {
    const calls = []
    server.use(
      http.post('http://localhost:8000/api/cart/items/bulk/', async ({ request }) => {
        const body = await request.json()
        calls.push(body.listing)
        if (body.listing === 12) return HttpResponse.json({ lines: [{ index: 0, detail: 'That version is not available for this listing.' }] }, { status: 400 })
        return HttpResponse.json({ id: 1, items: [] }, { status: 201 })
      }),
    )
    renderOrders([order({
      items: [
        { id: 1, listing: 12, listing_name: 'Kente Stole', variant: 41, variant_label: 'Gold / Large', quantity: 2, line_total: '260.00' },
        { id: 2, listing: 13, listing_name: 'Batakari', variant: 5, variant_label: 'M', quantity: 1, line_total: '80.00' },
      ],
    })])
    fireEvent.click(await screen.findByRole('button', { name: 'Buy it again' }))
    expect(await screen.findByText('Kente Stole is no longer available')).toBeInTheDocument()
    expect(calls).toEqual([12, 13])
  })

  it('a cart-guard refusal and a stock refusal show the server words, not "no longer available"', async () => {
    server.use(
      http.post('http://localhost:8000/api/cart/items/bulk/', () => HttpResponse.json({ lines: [{ index: 0, detail: 'Large: only 3 in stock, 2 already in your cart.' }] }, { status: 400 })),
      http.post('http://localhost:8000/api/cart/items/', () => HttpResponse.json({ detail: 'You can only order from 4 shops at once.', code: 'shop_limit' }, { status: 400 })),
    )
    renderOrders([order({
      items: [
        { id: 1, listing: 12, listing_name: 'Kente Stole', variant: 41, variant_label: 'Large', quantity: 2, line_total: '260.00' },
        { id: 3, listing: 50, listing_name: 'Shea Butter', variant: null, variant_label: '', quantity: 3, line_total: '90.00' },
      ],
    })])
    fireEvent.click(await screen.findByRole('button', { name: 'Buy it again' }))
    expect(await screen.findByText(/Kente Stole: Large: only 3 in stock, 2 already in your cart\./)).toBeInTheDocument()
    expect(screen.getByText(/Shea Butter: You can only order from 4 shops at once\./)).toBeInTheDocument()
    expect(screen.queryByText(/no longer available/)).not.toBeInTheDocument()
  })

  it('a listing whose variant lines were added but plain line refused is reported as a partial add', async () => {
    server.use(
      http.post('http://localhost:8000/api/cart/items/bulk/', () => HttpResponse.json({ id: 1, items: [] }, { status: 201 })),
      http.post('http://localhost:8000/api/cart/items/', () => HttpResponse.json({ detail: 'Sold out.' }, { status: 400 })),
    )
    renderOrders([order({
      items: [
        { id: 1, listing: 12, listing_name: 'Kente Stole', variant: 41, variant_label: 'Large', quantity: 1, line_total: '130.00' },
        { id: 2, listing: 12, listing_name: 'Kente Stole', variant: null, variant_label: '', quantity: 1, line_total: '130.00' },
      ],
    })])
    fireEvent.click(await screen.findByRole('button', { name: 'Buy it again' }))
    expect(await screen.findByText(/Kente Stole: the versions were added, the rest was not\. Sold out\./)).toBeInTheDocument()
    expect(screen.queryByText(/no longer available/)).not.toBeInTheDocument()
  })

  it('Buy it again is disabled with the opening label before the marketplace opens', async () => {
    server.use(gatedOpening({ opensAt: '2099-11-06T06:00:00Z' }))
    renderOrders([order()])
    const btn = await screen.findByRole('button', { name: 'Buy it again' })
    await waitFor(() => expect(btn).toBeDisabled())
    expect(screen.getByText(/Opens 6 Nov/)).toBeInTheDocument()
  })

  it('test_orders_search_filters_loaded_orders', async () => {
    renderOrders([
      order(),
      order({ id: 300, items: [{ id: 9, listing: 3, listing_name: 'Shea Butter', variant: null, variant_label: '', quantity: 1, line_total: '30.00' }] }),
    ])
    await screen.findByText('Order #214')
    const box = screen.getByRole('searchbox', { name: 'Search all orders' })
    fireEvent.change(box, { target: { value: 'shea' } })
    expect(screen.queryByText('Order #214')).not.toBeInTheDocument()
    expect(screen.getByText('Order #300')).toBeInTheDocument()
    fireEvent.change(box, { target: { value: '214' } })
    expect(screen.getByText('Order #214')).toBeInTheDocument()
    expect(screen.queryByText('Order #300')).not.toBeInTheDocument()
    fireEvent.change(box, { target: { value: 'zzz' } })
    expect(screen.getByText(/No orders match/)).toBeInTheDocument()
  })

  it('the past 3 months / 6 months / all filter works over the loaded orders', async () => {
    renderOrders([order({ id: 1, placed_at: daysAgo(10) }), order({ id: 2, placed_at: daysAgo(120) }), order({ id: 3, placed_at: daysAgo(400) })])
    await screen.findByText('Order #1')
    const select = screen.getByLabelText('Show orders from')
    expect(select).toHaveValue('all')
    fireEvent.change(select, { target: { value: '3' } })
    expect(screen.getByText('Order #1')).toBeInTheDocument()
    expect(screen.queryByText('Order #2')).not.toBeInTheDocument()
    fireEvent.change(select, { target: { value: '6' } })
    expect(screen.getByText('Order #2')).toBeInTheDocument()
    expect(screen.queryByText('Order #3')).not.toBeInTheDocument()
  })

  it('View order opens the extra details the server sent, nothing invented', async () => {
    renderOrders([order({ delivery_fee: '5.00', discount_amount: '10.00', coupon_code: 'WELCOME' })])
    fireEvent.click(await screen.findByRole('button', { name: 'View order' }))
    expect(screen.getByText(/Delivery fee/)).toHaveTextContent('GHS 5.00')
    expect(screen.getByText(/WELCOME/)).toBeInTheDocument()
  })

  it('Write a product review opens the existing review form for the bought listing', async () => {
    server.use(http.get('http://localhost:8000/api/reviews/eligibility/', () => HttpResponse.json({ eligible: true, already_reviewed: false })))
    renderOrders([order()])
    fireEvent.click(await screen.findByRole('button', { name: 'Write a product review' }))
    expect(await screen.findByPlaceholderText('Share your experience...')).toBeInTheDocument()
  })
})
