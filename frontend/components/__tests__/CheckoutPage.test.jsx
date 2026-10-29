import { afterEach, describe, expect, test, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '../../mocks/server.js'
import { gatedOpening } from '../../mocks/opening.js'
import CheckoutPage from '../shop/CheckoutPage.jsx'

// The global stub plus a second pin, so a test can move the pin from one point to another.
vi.mock('../LocationPicker.jsx', async () => {
  const { createElement, Fragment } = await import('react')
  return {
    default: ({ onChange, onAddress, lat, lng }) => createElement(Fragment, null,
      createElement('button', { type: 'button', 'data-testid': 'pin', 'data-lat': lat ?? '', 'data-lng': lng ?? '', onClick: () => { onChange(6.7, -1.62); if (onAddress) onAddress('KNUST Ave, Kumasi') } }, 'drop-pin'),
      createElement('button', { type: 'button', onClick: () => onChange(6.69, -1.62) }, 'drop-pin-out')),
  }
})

afterEach(() => { localStorage.clear() })

const API = 'http://localhost:8000'
const customer = { accountType: 'customer', id: 1, fullName: 'Ama Boateng' }
const CART = {
  id: 5, total: '300.00',
  items: [{
    id: 88, listing: 12, listing_name: 'Kente Stole', variant: 41, variant_label: 'Gold / Large', quantity: 2,
    unit_price_snapshot: '150.00', line_total: '300.00', seller_name: 'Akosua Ntoma',
  }],
}
const ORDER = { id: 42, status: 'paid', total_amount: '300.00', placed_at: '2026-10-29T00:00:00Z', delivery_method: 'store_pickup', items: [] }
const addr = (id, extra = {}) => ({
  id, label: 'Home', recipient_name: 'Akosua Mensah', phone: '0241234567', gps_address: 'AK-039-5028',
  landmark: 'Opposite Total filling station', address_text: '12 Adum Road, Kumasi', lat: '6.688200', lng: '-1.624400',
  is_default: false, created_at: '2026-10-28T09:15:22Z', ...extra,
})
const FEE = { fee: '12.00', fee_status: 'ok', waived: false, waiver_name: null, waived_fee: null, mixed_note: null, lines: null, route: null }
const OUT = { fee: null, fee_status: 'out_of_area', waived: false, waiver_name: null, waived_fee: null, mixed_note: null, message: 'We only deliver within the Ashanti Region for now.' }
const guardOf = (checkout = {}) => ({
  active: true, limits: {}, shops: [], food_shops: 0, at_shop_limit: false, at_food_limit: false,
  checkout: { any: null, door_to_door: null, ...checkout },
})
const LIMIT = { detail: 'Your delivery can include up to 4 shops. Your cart has 5. Remove 1 to check out.', code: 'shop_limit' }
const NOT_DELIVERABLE = { detail: 'Services are requested separately, and stays are booked separately. Remove them from your cart to check out.', code: 'not_deliverable' }

function StubPayment({ amount, processing, onSuccess, onClose }) {
  return (
    <div>
      <div>Pay {amount}</div>
      <div data-testid="stub-processing">{processing === undefined ? 'undefined' : processing}</div>
      <button onClick={() => onSuccess('REF123')}>Simulate Pay</button>
      <button onClick={onClose}>Done</button>
    </div>
  )
}

// One call wires every endpoint the page reads. `wallet` is a balance string, 'off' (ledger_off) or 'fail' (500).
function serve({
  cart = CART, wallet = '500.00', addresses = [], guard = guardOf(), processingFee = '4.50', preview = null,
  promos = false, quote = null, checkout = null, patch = null,
} = {}) {
  const seen = { checkout: [], setDefault: [], processing: [], patch: [], quote: [] }
  server.use(
    http.get(`${API}/api/cart/`, () => HttpResponse.json(cart)),
    http.get(`${API}/api/cart/guard/`, () => HttpResponse.json(guard)),
    http.get(`${API}/api/accounts/addresses/`, () => HttpResponse.json(addresses)),
    http.get(`${API}/api/wallet/`, () => {
      if (wallet === 'off') return HttpResponse.json({ detail: "Wallets aren't switched on yet.", code: 'ledger_off' }, { status: 409 })
      if (wallet === 'fail') return new HttpResponse(null, { status: 500 })
      return HttpResponse.json({ kind: 'customer', balance: wallet })
    }),
    http.get(`${API}/api/wallet/processing/`, ({ request }) => {
      const amount = new URL(request.url).searchParams.get('amount')
      seen.processing.push(amount)
      if (wallet === 'off') return HttpResponse.json({ detail: "Wallets aren't switched on yet.", code: 'ledger_off' }, { status: 409 })
      const cents = Math.round(Number(amount) * 100) + Math.round(Number(processingFee) * 100)
      return HttpResponse.json({ amount, payment_processing: processingFee, you_pay: (cents / 100).toFixed(2), provider: 'simulated' })
    }),
    http.get(`${API}/api/marketing/promos/public/`, () => HttpResponse.json({ enabled: promos, flash_sales: [] })),
    http.post(`${API}/api/marketing/cart/quote/`, async ({ request }) => {
      const body = await request.json()
      seen.quote.push(body)
      return typeof quote === 'function' ? quote(body) : HttpResponse.json(quote)
    }),
    http.get(`${API}/api/orders/delivery-preview/`, () => HttpResponse.json(preview ?? { delivery_from: null, delivered_from: null, deferred: false, source: null, delivery: null })),
    http.patch(`${API}/api/cart/items/:id/`, async ({ request }) => {
      const body = await request.json()
      seen.patch.push(body)
      return patch ? patch(body) : HttpResponse.json({ id: 88, quantity: body.quantity })
    }),
    http.post(`${API}/api/accounts/addresses/:id/set-default/`, ({ params }) => {
      seen.setDefault.push(Number(params.id))
      return HttpResponse.json(addr(Number(params.id), { is_default: true }))
    }),
    http.post(`${API}/api/orders/checkout/`, async ({ request }) => {
      const body = await request.json()
      seen.checkout.push(body)
      return checkout ? checkout(body) : HttpResponse.json({ ...ORDER, payment_method: body.payment_method }, { status: 201 })
    }),
  )
  return seen
}

function renderPage(props = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0 } } })
  const onNavigate = vi.fn()
  const ui = render(
    <QueryClientProvider client={client}>
      <CheckoutPage user={customer} currency="GHS" PaymentComponent={StubPayment} onNavigate={onNavigate} {...props} />
    </QueryClientProvider>,
  )
  return { ...ui, onNavigate }
}

const placeButton = () => screen.getByRole('button', { name: /Place your order in GHS/ })
const fill = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } })
const chooseWallet = async () => fireEvent.click(await screen.findByRole('radio', { name: /AshantiHub wallet/ }))
const fillManual = async ({ gps = 'AK0395028', landmark = 'Opposite Total filling station', phone = '0241234567' } = {}) => {
  await screen.findByLabelText('Ghana Post GPS address')
  fill('Phone number', phone)
  fill('Ghana Post GPS address', gps)
  fill('Landmark near your door', landmark)
}

describe('CheckoutPage: address and delivery method', () => {
  test('test_door_to_door_needs_a_valid_ghanapost_code_and_a_landmark_before_the_button_enables', async () => {
    serve()
    renderPage()
    await screen.findByLabelText('Ghana Post GPS address')
    expect(placeButton()).toBeDisabled()
    fill('Phone number', '0241234567')
    fill('Landmark near your door', 'Opposite Total filling station')
    fill('Ghana Post GPS address', 'BK0395028') // not an Ashanti code
    expect(await screen.findByText(/We deliver only in the Ashanti Region/)).toBeInTheDocument()
    expect(placeButton()).toBeDisabled()
    fill('Ghana Post GPS address', 'AK0395028')
    expect(screen.getByLabelText('Ghana Post GPS address')).toHaveValue('AK-039-5028')
    await waitFor(() => expect(placeButton()).toBeEnabled())
    fill('Landmark near your door', '   ')
    expect(placeButton()).toBeDisabled()
    fill('Landmark near your door', 'Opposite Total filling station')
    fill('Phone number', '')
    expect(placeButton()).toBeDisabled()
  })

  test('test_pickup_needs_no_address', async () => {
    const seen = serve()
    renderPage()
    await screen.findByLabelText('Ghana Post GPS address')
    fireEvent.click(screen.getByRole('radio', { name: /Store pickup/ }))
    expect(screen.queryByLabelText('Ghana Post GPS address')).not.toBeInTheDocument()
    expect(screen.queryByText('Delivering to')).not.toBeInTheDocument()
    await chooseWallet()
    await waitFor(() => expect(placeButton()).toBeEnabled())
    fireEvent.click(placeButton())
    await waitFor(() => expect(seen.checkout).toHaveLength(1))
    expect(seen.checkout[0]).toEqual({ payment_method: 'wallet', delivery_method: 'store_pickup' })
  })

  test('test_default_address_is_preselected', async () => {
    serve({ addresses: [addr(1, { is_default: true }), addr(2, { label: 'Work', recipient_name: 'Kofi Mensah', gps_address: 'AK-100-2000' })] })
    renderPage()
    expect(await screen.findByText('Delivering to')).toBeInTheDocument()
    const here = await screen.findByText('AK-039-5028')
    expect(within(here.closest('article')).getByText('Default')).toBeInTheDocument()
    expect(screen.queryByText('AK-100-2000')).not.toBeInTheDocument() // the other one only shows under Change
    await waitFor(() => expect(placeButton()).toBeEnabled())
    expect(screen.queryByLabelText('Ghana Post GPS address')).not.toBeInTheDocument()
  })

  test('test_default_to_this_address_calls_set_default', async () => {
    const seen = serve({ addresses: [addr(1, { is_default: true }), addr(2, { label: 'Work', recipient_name: 'Kofi Mensah', gps_address: 'AK-100-2000' })] })
    const { onNavigate } = renderPage()
    await screen.findByText('AK-039-5028')
    expect(screen.queryByLabelText('Default to this address')).not.toBeInTheDocument() // already the default
    fireEvent.click(screen.getByRole('button', { name: 'Change' }))
    fireEvent.click(await screen.findByRole('button', { name: /Kofi Mensah, AK-100-2000/ }))
    const tick = await screen.findByLabelText('Default to this address')
    fireEvent.click(tick)
    await chooseWallet()
    await waitFor(() => expect(placeButton()).toBeEnabled())
    fireEvent.click(placeButton())
    await waitFor(() => expect(seen.setDefault).toEqual([2]))
    expect(seen.checkout[0]).toMatchObject({ delivery_gps_address: 'AK-100-2000' })
  })

  test('test_an_untouched_default_tickbox_never_calls_set_default', async () => {
    const seen = serve({ addresses: [addr(1, { is_default: true }), addr(2, { label: 'Work', gps_address: 'AK-100-2000' })] })
    renderPage()
    await screen.findByText('AK-039-5028')
    fireEvent.click(screen.getByRole('button', { name: 'Change' }))
    fireEvent.click(await screen.findByRole('button', { name: /AK-100-2000/ }))
    await chooseWallet()
    fireEvent.click(placeButton())
    await waitFor(() => expect(seen.checkout).toHaveLength(1))
    expect(seen.setDefault).toEqual([])
  })

  test('test_guard_door_block_disables_door_to_door_and_leaves_pickup', async () => {
    serve({ guard: guardOf({ door_to_door: LIMIT }) })
    renderPage()
    expect(await screen.findByTestId('checkout-guard-note')).toHaveTextContent('Remove 1 to check out')
    expect(screen.getByTestId('checkout-guard-note')).toHaveTextContent('Store pickup is still available.')
    expect(screen.getByRole('radio', { name: /Door-to-door/ })).toBeDisabled()
    expect(screen.getByRole('radio', { name: /Store pickup/ })).toBeChecked()
    expect(screen.queryByLabelText('Ghana Post GPS address')).not.toBeInTheDocument()
    await waitFor(() => expect(placeButton()).toBeEnabled())
  })

  test('test_guard_any_block_blocks_everything_with_the_server_message', async () => {
    serve({ guard: guardOf({ any: NOT_DELIVERABLE }) })
    renderPage()
    expect(await screen.findByTestId('checkout-guard-note')).toHaveTextContent('Services are requested separately')
    expect(screen.getByTestId('checkout-guard-note')).not.toHaveTextContent('Store pickup is still available')
    expect(placeButton()).toBeDisabled()
  })

  test('test_place_stays_off_while_the_limits_are_loading_or_unreadable', async () => {
    serve({})
    server.use(http.get(`${API}/api/cart/guard/`, () => new Promise(() => {})))
    const loading = renderPage()
    fireEvent.click(await screen.findByRole('radio', { name: /Store pickup/ }))
    expect(await screen.findByTestId('checkout-guard-unchecked')).toHaveTextContent('Checking your delivery limits')
    expect(placeButton()).toBeDisabled()
    loading.unmount()
    server.use(http.get(`${API}/api/cart/guard/`, () => HttpResponse.json({ detail: 'x' }, { status: 500 })))
    renderPage()
    fireEvent.click(await screen.findByRole('radio', { name: /Store pickup/ }))
    expect(await screen.findByTestId('checkout-guard-unchecked')).toHaveTextContent("couldn't check your delivery limits")
    expect(placeButton()).toBeDisabled()
  })
})

describe('CheckoutPage: payment and the summary', () => {
  test('test_wallet_option_shows_balance_and_is_disabled_when_short_or_ledger_off', async () => {
    serve({ wallet: '500.00' })
    const rich = renderPage()
    const radio = await screen.findByRole('radio', { name: /AshantiHub wallet/ })
    expect(radio).toBeEnabled()
    expect(screen.getByText('GH₵ 500.00')).toBeInTheDocument()
    rich.unmount()

    serve({ wallet: '10.00' })
    const poor = renderPage()
    expect(await screen.findByRole('radio', { name: /AshantiHub wallet/ })).toBeDisabled()
    expect(screen.getByText(/Your balance is less than/)).toBeInTheDocument()
    poor.unmount()

    serve({ wallet: 'off' })
    renderPage()
    expect(await screen.findByTestId('checkout-wallet-off')).toHaveTextContent("Wallets aren't switched on yet.")
    expect(screen.queryByRole('radio', { name: /AshantiHub wallet/ })).not.toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /Mobile money/ })).toBeChecked()
    expect(screen.queryByTestId('processing-line')).not.toBeInTheDocument()
  })

  test('test_processing_line_comes_from_the_server_for_momo_only', async () => {
    serve({ processingFee: '4.50' })
    renderPage()
    const line = await screen.findByTestId('processing-line')
    expect(line).toHaveTextContent('Payment processing')
    expect(line).toHaveTextContent('GH₵ 4.50')
    expect(line).toHaveTextContent('GH₵ 304.50')
    expect(screen.getAllByTestId('processing-line')).toHaveLength(1)
    await chooseWallet()
    expect(screen.queryByTestId('processing-line')).not.toBeInTheDocument()
  })

  test('test_total_is_items_plus_delivery_plus_processing_minus_discount', async () => {
    const seen = serve({
      cart: { ...CART, total: '260.00' }, promos: true, processingFee: '4.50',
      quote: { enabled: true, items_subtotal: '260.00', discount: '26.00', total: '234.00', coupon: { code: 'WELCOME10', discount: '26.00' }, notes: [], delivery: FEE },
    })
    renderPage()
    await fillManual()
    fireEvent.click(await screen.findByText('drop-pin'))
    const summary = await screen.findByTestId('checkout-summary')
    await waitFor(() => expect(within(summary).getByTestId('summary-delivery')).toHaveTextContent('GH₵ 12.00'))
    expect(within(summary).getByTestId('summary-items')).toHaveTextContent('GH₵ 260.00')
    expect(within(summary).getByTestId('summary-discount')).toHaveTextContent('GH₵ 26.00')
    expect(within(summary).getByTestId('summary-total')).toHaveTextContent('GH₵ 246.00') // 260 + 12 - 26
    await waitFor(() => expect(within(summary).getByTestId('processing-line')).toHaveTextContent('GH₵ 250.50')) // + 4.50
    expect(seen.processing).toContain('246.00')
    expect(within(summary).queryByText(/tax|import/i)).not.toBeInTheDocument()
  })

  test('test_a_failed_processing_quote_blocks_momo_with_a_reason_and_retry', async () => {
    let fail = true
    serve({ addresses: [addr(1, { is_default: true })] })
    server.use(http.get(`${API}/api/wallet/processing/`, ({ request }) => (fail ? new HttpResponse(null, { status: 500 })
      : HttpResponse.json({ amount: new URL(request.url).searchParams.get('amount'), payment_processing: '4.50', you_pay: '304.50', provider: 'simulated' }))))
    renderPage()
    await screen.findByText('AK-039-5028')
    expect(await screen.findByText(/We couldn't get the payment processing charge/)).toBeInTheDocument()
    expect(placeButton()).toBeDisabled()
    fail = false
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(placeButton()).toBeEnabled())
  })

  test('test_delivery_fee_says_choose_a_delivery_point_until_pinned', async () => {
    serve({ preview: { delivery_from: null, delivered_from: null, deferred: false, source: null, delivery: { ...FEE, fee: null, fee_status: 'needs_location' } } })
    renderPage()
    await screen.findByLabelText('Ghana Post GPS address')
    expect(screen.getByTestId('summary-delivery')).toHaveTextContent('Choose a delivery point')
  })

  test('test_out_of_area_pin_disables_the_button', async () => {
    serve({ promos: true, quote: (body) => HttpResponse.json({ enabled: true, total: '300.00', delivery: body.delivery_lat ? OUT : FEE }) })
    renderPage()
    await fillManual()
    await waitFor(() => expect(placeButton()).toBeEnabled())
    fireEvent.click(await screen.findByText('drop-pin'))
    expect(await screen.findByText('We only deliver within the Ashanti Region for now.')).toBeInTheDocument()
    expect(placeButton()).toBeDisabled()
  })

  test('test_a_failed_delivery_quote_keeps_the_button_off_and_says_so', async () => {
    serve({ promos: true, quote: () => HttpResponse.json({ detail: 'boom' }, { status: 500 }) })
    renderPage()
    await fillManual()
    fireEvent.click(await screen.findByText('drop-pin'))
    expect(await screen.findByText("We couldn't check delivery to this location yet. Try again.")).toBeInTheDocument()
    expect(placeButton()).toBeDisabled()
  })

  test('test_the_processing_quote_waits_for_the_delivery_fee_of_the_pin', async () => {
    let release
    const gate = new Promise((r) => { release = r })
    const seen = serve({})
    server.use(http.get(`${API}/api/orders/delivery-preview/`, async ({ request }) => {
      if (new URL(request.url).searchParams.get('lat')) await gate
      return HttpResponse.json({ delivery_from: null, delivered_from: null, deferred: false, source: null, delivery: FEE })
    }))
    renderPage()
    await fillManual()
    await waitFor(() => expect(placeButton()).toBeEnabled())
    seen.processing.length = 0
    fireEvent.click(await screen.findByText('drop-pin'))
    expect(await screen.findByText('Checking the delivery fee…')).toBeInTheDocument()
    expect(placeButton()).toBeDisabled()
    expect(seen.processing).not.toContain('300.00')
    release()
    await waitFor(() => expect(screen.queryByText('Checking the delivery fee…')).not.toBeInTheDocument())
    await waitFor(() => expect(seen.processing).toContain('312.00'))
    await waitFor(() => expect(placeButton()).toBeEnabled())
  })

  test('test_a_multi_shop_fee_lists_every_line_and_flags_a_straight_line_estimate', async () => {
    const lines = [{ label: 'Base', amount: '8.00' }, { label: 'Extra pickup', amount: '0.00' }]
    serve({ preview: { delivery_from: null, delivered_from: null, deferred: false, source: null, delivery: { ...FEE, fee: '8.00', lines, route: { stops: 2, planned: false } } } })
    renderPage()
    await fillManual()
    fireEvent.click(await screen.findByText('drop-pin'))
    const list = await screen.findByRole('list', { name: 'Delivery fee breakdown' })
    expect(list).toHaveTextContent('Base: GH₵ 8.00')
    expect(list).toHaveTextContent('Extra pickup: GH₵ 0.00')
    expect(screen.getByText(/straight-line estimate/)).toBeInTheDocument()
  })

  test('test_after_hours_notice_for_a_deferred_door_to_door_delivery', async () => {
    serve({ preview: { delivery_from: '2026-10-20T08:00:00Z', delivered_from: '2026-10-20T08:00:00Z', deferred: true, source: 'platform', delivery: null } })
    renderPage()
    expect(await screen.findByTestId('checkout-after-hours')).toHaveTextContent('Delivery starts Tue 08:00.')
    fireEvent.click(screen.getByRole('radio', { name: /Store pickup/ }))
    expect(screen.queryByTestId('checkout-after-hours')).not.toBeInTheDocument()
  })

  test('test_review_items_show_the_variant_and_a_quantity_stepper', async () => {
    const seen = serve()
    renderPage()
    const review = await screen.findByTestId('checkout-review')
    expect(within(review).getByText('Kente Stole')).toBeInTheDocument()
    expect(within(review).getByText('Gold / Large')).toBeInTheDocument()
    fireEvent.click(within(review).getByRole('button', { name: 'Increase quantity of Kente Stole' }))
    await waitFor(() => expect(seen.patch).toEqual([{ quantity: 3 }]))
  })

  test('test_no_card_digits_or_gift_card_fields_anywhere', async () => {
    serve({ addresses: [addr(1, { is_default: true })] })
    const { container } = renderPage()
    await screen.findByText('AK-039-5028')
    const text = container.textContent
    expect(text).not.toMatch(/card number|gift card|cvv|expiry|promo balance|\*\*\*\*|••••|tax|import (charge|duty)|exchange rate|convert/i)
    expect(container.querySelector('input[name*="card" i], input[autocomplete^="cc-"]')).toBeNull()
    expect(text).toContain('Your default payment method is not saved')
    expect(text).toContain('you choose at checkout')
    expect(text).not.toMatch(/delivered by|arrives|estimated delivery/i)
  })
})

describe('CheckoutPage: placing the order', () => {
  const ready = async () => {
    await screen.findByLabelText('Ghana Post GPS address')
  }

  test('test_wallet_order_posts_payment_method_wallet_with_gps_and_landmark', async () => {
    const seen = serve({ addresses: [addr(1, { is_default: true })] })
    const { onNavigate } = renderPage()
    await screen.findByText('AK-039-5028')
    await chooseWallet()
    await waitFor(() => expect(placeButton()).toBeEnabled())
    fireEvent.click(placeButton())
    await waitFor(() => expect(onNavigate).toHaveBeenCalled())
    expect(seen.checkout).toEqual([{
      payment_method: 'wallet', delivery_method: 'door_to_door', delivery_address: '12 Adum Road, Kumasi', delivery_phone: '0241234567',
      delivery_lat: 6.6882, delivery_lng: -1.6244, delivery_gps_address: 'AK-039-5028', delivery_landmark: 'Opposite Total filling station',
    }])
    expect(screen.queryByText('Simulate Pay')).not.toBeInTheDocument() // the wallet never opens the mobile money modal
  })

  test('test_a_typed_address_posts_its_own_fields', async () => {
    const seen = serve()
    renderPage()
    await fillManual({ landmark: 'Blue gate, behind the church' })
    fireEvent.click(await screen.findByText('drop-pin'))
    await chooseWallet()
    await waitFor(() => expect(placeButton()).toBeEnabled())
    fireEvent.click(placeButton())
    await waitFor(() => expect(seen.checkout).toHaveLength(1))
    expect(seen.checkout[0]).toEqual({
      payment_method: 'wallet', delivery_method: 'door_to_door', delivery_address: 'KNUST Ave, Kumasi', delivery_phone: '0241234567',
      delivery_lat: 6.7, delivery_lng: -1.62, delivery_gps_address: 'AK-039-5028', delivery_landmark: 'Blue gate, behind the church',
    })
  })

  test('test_momo_order_opens_the_payment_component_then_posts', async () => {
    const seen = serve({ addresses: [addr(1, { is_default: true })], processingFee: '4.50' })
    const { onNavigate } = renderPage()
    await screen.findByText('AK-039-5028')
    await screen.findByTestId('processing-line')
    await waitFor(() => expect(placeButton()).toBeEnabled())
    fireEvent.click(placeButton())
    expect(await screen.findByText('Pay 300')).toBeInTheDocument()
    expect(screen.getByTestId('stub-processing')).toHaveTextContent('4.50')
    expect(seen.checkout).toHaveLength(0) // nothing is posted until the number is collected and paid
    fireEvent.click(screen.getByText('Simulate Pay'))
    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith('/checkout/verify?order=42'))
    expect(seen.checkout[0]).toMatchObject({ payment_method: 'momo', delivery_method: 'door_to_door', delivery_gps_address: 'AK-039-5028' })
  })

  test('test_closing_the_payment_component_posts_nothing', async () => {
    const seen = serve({ addresses: [addr(1, { is_default: true })] })
    renderPage()
    await screen.findByText('AK-039-5028')
    await waitFor(() => expect(placeButton()).toBeEnabled())
    fireEvent.click(placeButton())
    fireEvent.click(await screen.findByText('Done'))
    expect(screen.queryByText('Simulate Pay')).not.toBeInTheDocument()
    expect(seen.checkout).toHaveLength(0)
    expect(placeButton()).toBeEnabled()
  })

  test('test_ledger_off_checkout_sends_no_payment_method', async () => {
    const seen = serve({ wallet: 'off', addresses: [addr(1, { is_default: true })] })
    renderPage()
    await screen.findByText('AK-039-5028')
    await waitFor(() => expect(placeButton()).toBeEnabled())
    fireEvent.click(placeButton())
    expect(await screen.findByTestId('stub-processing')).toHaveTextContent('undefined')
    fireEvent.click(screen.getByText('Simulate Pay'))
    await waitFor(() => expect(seen.checkout).toHaveLength(1))
    expect(seen.checkout[0]).not.toHaveProperty('payment_method')
  })

  test('test_redirect_answer_navigates_to_checkout_url', async () => {
    const assign = vi.fn()
    const original = window.location
    Object.defineProperty(window, 'location', { configurable: true, value: { ...original, assign } })
    try {
      serve({ addresses: [addr(1, { is_default: true })], checkout: () => HttpResponse.json({ mode: 'redirect', checkout_url: 'https://pay.hubtel.com/abc', reference: 'AH-1' }) })
      const { onNavigate } = renderPage()
      await screen.findByText('AK-039-5028')
      await waitFor(() => expect(placeButton()).toBeEnabled())
      fireEvent.click(placeButton())
      fireEvent.click(await screen.findByText('Simulate Pay'))
      await waitFor(() => expect(assign).toHaveBeenCalledWith('https://pay.hubtel.com/abc'))
      expect(onNavigate).not.toHaveBeenCalled()
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: original })
    }
  })

  test('test_201_navigates_to_verify_with_the_order_id', async () => {
    serve({ addresses: [addr(1, { is_default: true })], checkout: () => HttpResponse.json({ ...ORDER, id: 214, payment_method: 'wallet' }, { status: 201 }) })
    const { onNavigate } = renderPage()
    await screen.findByText('AK-039-5028')
    await chooseWallet()
    await waitFor(() => expect(placeButton()).toBeEnabled())
    fireEvent.click(placeButton())
    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith('/checkout/verify?order=214'))
  })

  test('test_server_refusal_keeps_the_cart_and_shows_the_detail', async () => {
    const detail = "Your AshantiHub wallet doesn't hold enough for this order."
    const cartWrites = []
    const seen = serve({ addresses: [addr(1, { is_default: true })], checkout: () => HttpResponse.json({ detail, code: 'insufficient_funds' }, { status: 409 }) })
    server.use(http.delete(`${API}/api/cart/items/:id/`, ({ params }) => { cartWrites.push(`delete ${params.id}`); return new HttpResponse(null, { status: 204 }) }))
    const { onNavigate } = renderPage()
    await screen.findByText('AK-039-5028')
    await chooseWallet()
    await waitFor(() => expect(placeButton()).toBeEnabled())
    fireEvent.click(placeButton())
    expect(await screen.findByText(detail)).toBeInTheDocument()
    expect(onNavigate).not.toHaveBeenCalled()
    expect(seen.checkout).toHaveLength(1)
    expect(within(screen.getByTestId('checkout-review')).getByText('Kente Stole')).toBeInTheDocument()
    expect(within(screen.getByTestId('checkout-review')).getByText('2')).toBeInTheDocument() // still two of them
    expect(cartWrites).toEqual([]) // no line removed
    expect(seen.patch).toEqual([]) // no quantity changed
    expect(seen.setDefault).toEqual([]) // nothing else was changed for an order that was refused
    await waitFor(() => expect(placeButton()).toBeEnabled()) // the shopper can try again or pay another way
  })

  test('test_a_stock_refusal_shows_only_n_left_verbatim', async () => {
    const detail = 'Only 1 of “Kente Stole (Gold / Large)” left in stock.'
    serve({ addresses: [addr(1, { is_default: true })], checkout: () => HttpResponse.json({ detail }, { status: 400 }) })
    renderPage()
    await screen.findByText('AK-039-5028')
    await chooseWallet()
    await waitFor(() => expect(placeButton()).toBeEnabled())
    fireEvent.click(placeButton())
    expect(await screen.findByText(detail)).toBeInTheDocument()
  })

  test('test_a_refusal_after_the_momo_payment_keeps_the_reference', async () => {
    const detail = 'We only deliver within the Ashanti Region for now.'
    serve({ addresses: [addr(1, { is_default: true })], checkout: () => HttpResponse.json({ detail, code: 'out_of_area' }, { status: 400 }) })
    renderPage()
    await screen.findByText('AK-039-5028')
    await waitFor(() => expect(placeButton()).toBeEnabled())
    fireEvent.click(placeButton())
    fireEvent.click(await screen.findByText('Simulate Pay'))
    expect(await screen.findByText(detail)).toBeInTheDocument()
    expect(screen.getByText(/Your order was not placed\. Payment reference: REF123\./)).toBeInTheDocument()
  })

  test('test_double_click_posts_once', async () => {
    let posts = 0
    serve({ addresses: [addr(1, { is_default: true })], checkout: async () => {
      posts += 1
      await new Promise((r) => setTimeout(r, 80))
      return HttpResponse.json({ ...ORDER, payment_method: 'wallet' }, { status: 201 })
    } })
    const { onNavigate } = renderPage()
    await screen.findByText('AK-039-5028')
    await chooseWallet()
    await waitFor(() => expect(placeButton()).toBeEnabled())
    const button = placeButton()
    fireEvent.click(button)
    fireEvent.click(button)
    await waitFor(() => expect(onNavigate).toHaveBeenCalled())
    expect(posts).toBe(1)
  })

  test('test_disabled_before_opening_with_opens_6_nov', async () => {
    server.use(gatedOpening({ opensAt: '2026-11-06T06:00:00Z', serverNow: '2026-10-29T10:00:00Z' }))
    serve({ addresses: [addr(1, { is_default: true })] })
    renderPage()
    await screen.findByText('AK-039-5028')
    await waitFor(() => expect(screen.getByTestId('checkout-reason')).toHaveTextContent('Opens 6 Nov'))
    expect(placeButton()).toBeDisabled()
  })

  test('test_staff_session_gets_the_staff_notice', async () => {
    serve()
    renderPage({ user: { accountType: 'staff', fullName: 'Akosua Support' } })
    expect(await screen.findByText("Staff accounts can't shop or sell. Sign out first.")).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Place your order/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
  })

  test('test_a_pending_or_failed_wallet_read_keeps_the_button_off_and_retry_recovers', async () => {
    let fail = true
    serve({ addresses: [addr(1, { is_default: true })] })
    server.use(http.get(`${API}/api/wallet/`, () => (fail ? new HttpResponse(null, { status: 500 }) : HttpResponse.json({ kind: 'customer', balance: '500.00' }))))
    renderPage()
    await screen.findByText('AK-039-5028')
    const alert = await screen.findByTestId('checkout-wallet-failed')
    expect(placeButton()).toBeDisabled()
    fail = false
    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('radio', { name: /AshantiHub wallet/ })).toBeInTheDocument()
    await waitFor(() => expect(placeButton()).toBeEnabled())
  })

  test('test_the_gold_button_is_the_only_place_order_action_and_the_cart_link_goes_back', async () => {
    serve()
    const { onNavigate } = renderPage()
    await ready()
    expect(screen.getAllByRole('button', { name: /Place your order/ })).toHaveLength(1)
    fireEvent.click(screen.getByRole('link', { name: /Back to cart/ }))
    expect(onNavigate).toHaveBeenCalledWith('/cart')
  })

  test('test_an_empty_cart_sends_the_shopper_back_instead_of_a_blank_form', async () => {
    serve({ cart: { id: 5, items: [], total: '0.00' } })
    renderPage()
    expect(await screen.findByText('Your cart is empty.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Place your order/ })).not.toBeInTheDocument()
  })
})

describe('CheckoutPage: pin follows the address in use', () => {
  const SAVED = [addr(1, { is_default: true })]

  test('test_switching_between_a_saved_and_a_typed_address_never_carries_the_other_pin', async () => {
    const seen = serve({ addresses: SAVED })
    renderPage()
    await screen.findByText('AK-039-5028')
    expect(screen.getByTestId('pin')).toHaveAttribute('data-lat', '6.6882')
    fireEvent.click(screen.getByRole('button', { name: 'Deliver somewhere else this time' }))
    expect(screen.getByTestId('pin')).toHaveAttribute('data-lat', '') // the saved pin is gone
    await fillManual({ landmark: 'Blue gate' })
    fireEvent.click(screen.getByText('drop-pin'))
    expect(screen.getByTestId('pin')).toHaveAttribute('data-lat', '6.7')
    fireEvent.click(screen.getByRole('button', { name: 'Use a saved address' }))
    expect(screen.getByTestId('pin')).toHaveAttribute('data-lat', '6.6882') // back to the saved address's own pin
    expect(screen.getByText('AK-039-5028')).toBeInTheDocument()
    await chooseWallet()
    await waitFor(() => expect(placeButton()).toBeEnabled())
    fireEvent.click(placeButton())
    await waitFor(() => expect(seen.checkout).toHaveLength(1))
    expect(seen.checkout[0]).toMatchObject({ delivery_gps_address: 'AK-039-5028', delivery_lat: 6.6882, delivery_lng: -1.6244 })
  })
})

describe('CheckoutPage: assertions moved from the cart drawer', () => {
  test('test_pickup_note_promises_a_code_only_when_the_ledger_is_on', async () => {
    serve({ wallet: 'off' })
    const off = renderPage()
    fireEvent.click(await screen.findByRole('radio', { name: /Store pickup/ }))
    await screen.findByTestId('pickup-collection-note')
    expect(screen.queryByText(/once you have paid/)).not.toBeInTheDocument()
    off.unmount()
    serve({ wallet: '500.00' })
    renderPage()
    fireEvent.click(await screen.findByRole('radio', { name: /Store pickup/ }))
    expect(await screen.findByText('You get a one-time collection code once you have paid.')).toBeInTheDocument()
  })

  test('test_zero_total_blocks_momo_and_points_to_the_wallet', async () => {
    serve({ cart: { ...CART, total: '0.00' }, addresses: [addr(1, { is_default: true })] })
    renderPage()
    expect(await screen.findByText('There is nothing to pay by mobile money. Choose your AshantiHub wallet.')).toBeInTheDocument()
    expect(placeButton()).toBeDisabled()
  })

  test('test_pending_wallet_read_keeps_the_button_off', async () => {
    serve({ addresses: [addr(1, { is_default: true })] })
    server.use(http.get(`${API}/api/wallet/`, async () => {
      await new Promise((r) => setTimeout(r, 300))
      return HttpResponse.json({ kind: 'customer', balance: '500.00' })
    }))
    renderPage()
    await screen.findByText('AK-039-5028')
    expect(screen.getByText('Checking payment options…')).toBeInTheDocument()
    expect(placeButton()).toBeDisabled()
    await waitFor(() => expect(placeButton()).toBeEnabled())
    expect(screen.queryByText('Checking payment options…')).not.toBeInTheDocument()
  })

  test('test_promotions_on_uses_the_quote_fee_not_the_previews', async () => {
    serve({
      promos: true,
      preview: { delivery_from: null, delivered_from: null, deferred: false, source: null, delivery: { ...FEE, fee: '99.00' } },
      quote: { enabled: true, total: '300.00', lines: [], notes: [], delivery: { ...FEE, fee: '12.00' } },
    })
    renderPage()
    await fillManual()
    fireEvent.click(await screen.findByText('drop-pin'))
    await waitFor(() => expect(screen.getByTestId('summary-delivery')).toHaveTextContent('GH₵ 12.00'))
    expect(screen.getByTestId('summary-total')).toHaveTextContent('GH₵ 312.00')
    expect(screen.queryByText(/99\.00/)).not.toBeInTheDocument()
  })

  test('test_a_moved_pin_keeps_the_button_off_while_its_quote_is_pending_and_once_it_is_out_of_area', async () => {
    let release
    const gate = new Promise((r) => { release = r })
    serve({
      promos: true,
      quote: async (body) => {
        if (body.delivery_lat === 6.69) { await gate; return HttpResponse.json({ enabled: true, total: '300.00', delivery: OUT }) }
        return HttpResponse.json({ enabled: true, total: '300.00', delivery: FEE })
      },
    })
    renderPage()
    await fillManual()
    fireEvent.click(await screen.findByText('drop-pin'))
    await waitFor(() => expect(screen.getByTestId('summary-delivery')).toHaveTextContent('GH₵ 12.00'))
    await waitFor(() => expect(placeButton()).toBeEnabled())
    fireEvent.click(screen.getByText('drop-pin-out'))
    expect(placeButton()).toBeDisabled() // the old quote must not answer for the new pin
    await new Promise((r) => setTimeout(r, 50))
    expect(placeButton()).toBeDisabled()
    release()
    expect(await screen.findByText('We only deliver within the Ashanti Region for now.')).toBeInTheDocument()
    expect(placeButton()).toBeDisabled()
  })

  test('test_the_payment_amount_stays_stable_after_the_cart_empties_mid_payment', async () => {
    let reads = 0
    serve({ addresses: [addr(1, { is_default: true })] })
    server.use(http.get(`${API}/api/cart/`, () => { reads += 1; return HttpResponse.json(reads === 1 ? CART : { id: 5, items: [], total: '0.00' }) }))
    renderPage()
    await screen.findByText('AK-039-5028')
    await waitFor(() => expect(placeButton()).toBeEnabled())
    fireEvent.click(placeButton())
    expect(await screen.findByText('Pay 300')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Simulate Pay'))
    await waitFor(() => expect(reads).toBeGreaterThan(1))
    expect(screen.getByText('Pay 300')).toBeInTheDocument()
    expect(screen.queryByText(/Pay 0/)).not.toBeInTheDocument()
  })

  test('test_free_delivery_labels_the_lines_as_value_not_a_charge', async () => {
    const lines = [{ label: 'Base', amount: '8.00' }, { label: 'Extra pickup', amount: '0.00' }]
    serve({ preview: { delivery_from: null, delivered_from: null, deferred: false, source: null, delivery: { ...FEE, fee: '0.00', waived: true, waiver_name: 'Free week', waived_fee: '8.00', lines, route: { stops: 2, planned: true } } } })
    renderPage()
    await fillManual()
    fireEvent.click(await screen.findByText('drop-pin'))
    expect(await screen.findByText('Delivery value (not charged):')).toBeInTheDocument()
    expect(screen.queryByText(/straight-line estimate/)).not.toBeInTheDocument()
  })

  test('test_after_hours_wording_and_its_absences', async () => {
    const deferred = { delivery_from: '2026-10-20T08:00:00Z', delivered_from: '2026-10-20T08:00:00Z', deferred: true }
    serve({ preview: { ...deferred, source: 'business_hours', delivery: null } })
    const closed = renderPage()
    expect(await screen.findByTestId('checkout-after-hours')).toHaveTextContent('Shop is closed now. Delivery starts Tue 08:00.')
    closed.unmount()

    serve({ preview: { ...deferred, source: 'platform', delivery: null } })
    const platform = renderPage()
    const note = await screen.findByTestId('checkout-after-hours')
    expect(note).not.toHaveTextContent(/closed/i)
    platform.unmount()

    // Served answers that must produce no notice; absence is asserted after the request was answered.
    for (const [body, status] of [[{ delivery_from: null, delivered_from: null, deferred: false, source: null, delivery: null }, 200], [{ detail: 'x' }, 500]]) {
      serve({})
      let answered
      const hit = new Promise((r) => { answered = r })
      server.use(http.get(`${API}/api/orders/delivery-preview/`, () => { answered(); return HttpResponse.json(body, { status }) }))
      const view = renderPage()
      await hit
      await new Promise((r) => setTimeout(r, 30))
      expect(screen.queryByTestId('checkout-after-hours')).not.toBeInTheDocument()
      view.unmount()
    }
  })
})

describe('CheckoutPage: money-screen correctness', () => {
  test('test_ordering_waits_for_the_delivery_fee_of_the_pin_even_with_the_ledger_off', async () => {
    let release
    const gate = new Promise((r) => { release = r })
    serve({ wallet: 'off' })
    server.use(http.get(`${API}/api/orders/delivery-preview/`, async ({ request }) => {
      if (new URL(request.url).searchParams.get('lat')) await gate
      return HttpResponse.json({ delivery_from: null, delivered_from: null, deferred: false, source: null, delivery: FEE })
    }))
    renderPage()
    await fillManual()
    await waitFor(() => expect(placeButton()).toBeEnabled())
    fireEvent.click(await screen.findByText('drop-pin'))
    expect(await screen.findByText('Checking the delivery fee…')).toBeInTheDocument()
    expect(placeButton()).toBeDisabled()
    release()
    await waitFor(() => expect(placeButton()).toBeEnabled())
    fireEvent.click(placeButton())
    expect(await screen.findByText('Pay 312')).toBeInTheDocument() // the window opens with the fee included
  })

  test('test_default_address_is_set_only_after_the_order_is_accepted', async () => {
    const order = []
    const seen = serve({ addresses: [addr(1, { is_default: true }), addr(2, { label: 'Work', gps_address: 'AK-100-2000' })], checkout: () => { order.push('checkout'); return HttpResponse.json({ detail: 'Only 1 left.' }, { status: 400 }) } })
    server.use(http.post(`${API}/api/accounts/addresses/:id/set-default/`, () => { order.push('set-default'); return HttpResponse.json(addr(2, { is_default: true })) }))
    renderPage()
    await screen.findByText('AK-039-5028')
    fireEvent.click(screen.getByRole('button', { name: 'Change' }))
    fireEvent.click(await screen.findByRole('button', { name: /AK-100-2000/ }))
    fireEvent.click(await screen.findByLabelText('Default to this address'))
    await chooseWallet()
    await waitFor(() => expect(placeButton()).toBeEnabled())
    fireEvent.click(placeButton())
    expect(await screen.findByText('Only 1 left.')).toBeInTheDocument()
    expect(order).toEqual(['checkout']) // refused: the default is left alone
    expect(seen.setDefault).toEqual([])
  })

  test('test_a_failed_default_is_noted_after_the_order_is_placed', async () => {
    serve({ addresses: [addr(1, { is_default: true }), addr(2, { label: 'Work', gps_address: 'AK-100-2000' })] })
    server.use(http.post(`${API}/api/accounts/addresses/:id/set-default/`, () => new HttpResponse(null, { status: 500 })))
    const { onNavigate } = renderPage()
    await screen.findByText('AK-039-5028')
    fireEvent.click(screen.getByRole('button', { name: 'Change' }))
    fireEvent.click(await screen.findByRole('button', { name: /AK-100-2000/ }))
    fireEvent.click(await screen.findByLabelText('Default to this address'))
    await chooseWallet()
    await waitFor(() => expect(placeButton()).toBeEnabled())
    fireEvent.click(placeButton())
    expect(await screen.findByTestId('checkout-default-note')).toHaveTextContent('Your order is placed, but we could not make this your default address.')
    expect(onNavigate).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Continue to your order' }))
    expect(onNavigate).toHaveBeenCalledWith('/checkout/verify?order=42')
  })

  // FB1: the server empties the cart the moment the order is accepted, so the refetch must not replace the page.
  const emptyAfterOrder = () => {
    let placed = false
    server.use(
      http.get(`${API}/api/cart/`, () => HttpResponse.json(placed ? { id: 5, items: [], total: '0.00' } : CART)),
      http.post(`${API}/api/orders/checkout/`, () => { placed = true; return HttpResponse.json({ ...ORDER, payment_method: 'wallet' }, { status: 201 }) }),
    )
  }

  test('test_a_failed_cart_refetch_after_the_order_is_accepted_keeps_the_placed_note', async () => {
    serve({ addresses: [addr(1, { is_default: true }), addr(2, { label: 'Work', gps_address: 'AK-100-2000' })] })
    let placed = false
    server.use(
      http.get(`${API}/api/cart/`, () => (placed ? new HttpResponse(null, { status: 500 }) : HttpResponse.json(CART))),
      http.post(`${API}/api/orders/checkout/`, () => { placed = true; return HttpResponse.json({ ...ORDER, payment_method: 'wallet' }, { status: 201 }) }),
      http.post(`${API}/api/accounts/addresses/:id/set-default/`, () => new HttpResponse(null, { status: 500 })),
    )
    const { onNavigate } = renderPage()
    await screen.findByText('AK-039-5028')
    fireEvent.click(screen.getByRole('button', { name: 'Change' }))
    fireEvent.click(await screen.findByRole('button', { name: /AK-100-2000/ }))
    fireEvent.click(await screen.findByLabelText('Default to this address'))
    await chooseWallet()
    await waitFor(() => expect(placeButton()).toBeEnabled())
    fireEvent.click(placeButton())
    expect(await screen.findByTestId('checkout-default-note')).toBeInTheDocument()
    expect(screen.queryByText(/couldn.t load your cart/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Continue to your order' }))
    expect(onNavigate).toHaveBeenCalledWith('/checkout/verify?order=42')
  })

  test('test_a_failed_default_still_shows_the_placed_note_when_the_cart_comes_back_empty', async () => {
    serve({ addresses: [addr(1, { is_default: true }), addr(2, { label: 'Work', gps_address: 'AK-100-2000' })] })
    emptyAfterOrder()
    server.use(http.post(`${API}/api/accounts/addresses/:id/set-default/`, () => new HttpResponse(null, { status: 500 })))
    const { onNavigate } = renderPage()
    await screen.findByText('AK-039-5028')
    fireEvent.click(screen.getByRole('button', { name: 'Change' }))
    fireEvent.click(await screen.findByRole('button', { name: /AK-100-2000/ }))
    fireEvent.click(await screen.findByLabelText('Default to this address'))
    await chooseWallet()
    await waitFor(() => expect(placeButton()).toBeEnabled())
    fireEvent.click(placeButton())
    expect(await screen.findByTestId('checkout-default-note')).toHaveTextContent('Your order is placed, but we could not make this your default address.')
    expect(screen.queryByText('Your cart is empty.')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Continue to your order' }))
    expect(onNavigate).toHaveBeenCalledWith('/checkout/verify?order=42')
  })

  test('test_the_empty_cart_text_never_flashes_on_the_happy_path_with_a_default_ticked', async () => {
    serve({ addresses: [addr(1, { is_default: true }), addr(2, { label: 'Work', gps_address: 'AK-100-2000' })] })
    emptyAfterOrder()
    const { onNavigate, container } = renderPage()
    let flashed = false
    new MutationObserver(() => { if (container.textContent.includes('Your cart is empty.')) flashed = true }).observe(container, { childList: true, subtree: true, characterData: true })
    await screen.findByText('AK-039-5028')
    fireEvent.click(screen.getByRole('button', { name: 'Change' }))
    fireEvent.click(await screen.findByRole('button', { name: /AK-100-2000/ }))
    fireEvent.click(await screen.findByLabelText('Default to this address'))
    await chooseWallet()
    await waitFor(() => expect(placeButton()).toBeEnabled())
    fireEvent.click(placeButton())
    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith('/checkout/verify?order=42'))
    expect(flashed).toBe(false)
  })

  test('test_a_signed_in_customer_whose_session_is_still_loading_never_sees_sign_in', async () => {
    serve()
    const loading = renderPage({ user: null, authLoading: true, onSignIn: vi.fn() })
    expect(screen.getByText(/Loading your checkout/)).toBeInTheDocument()
    expect(screen.queryByText('Sign in to check out.')).not.toBeInTheDocument()
    loading.unmount()
    renderPage({ user: null, authLoading: false, onSignIn: vi.fn() })
    expect(screen.getByText('Sign in to check out.')).toBeInTheDocument()
  })
})

describe('CheckoutPage: the delivery pin while delivery fees are on (P45)', () => {
  const NEEDS = { fee: null, fee_status: 'needs_location', waived: false, waiver_name: null, waived_fee: null, mixed_note: null, lines: null, route: null }
  const PIN_MESSAGE = 'Pin your door on the map so we can work out the delivery fee.'
  const previewByPin = (request) => {
    const pinned = new URL(request.url).searchParams.has('lat')
    return HttpResponse.json({ delivery_from: null, delivered_from: null, deferred: false, source: null, delivery: pinned ? FEE : NEEDS })
  }

  test('test_a_pinless_saved_address_holds_place_order_until_the_door_is_pinned', async () => {
    serve({ addresses: [addr(1, { is_default: true, lat: null, lng: null })] })
    server.use(http.get(`${API}/api/orders/delivery-preview/`, ({ request }) => previewByPin(request)))
    renderPage()
    await screen.findByText('AK-039-5028')
    await chooseWallet()
    expect(await screen.findByTestId('checkout-reason')).toHaveTextContent(PIN_MESSAGE)
    expect(placeButton()).toBeDisabled()
    fireEvent.click(await screen.findByText('drop-pin'))
    await waitFor(() => expect(placeButton()).toBeEnabled())
    expect(screen.queryByText(PIN_MESSAGE)).not.toBeInTheDocument()
  })

  test('test_a_pinned_door_the_server_still_cannot_measure_is_not_held', async () => {
    // needs_location also answers a pinned door whose first shop has no location; the server accepts that order.
    const seen = serve({ addresses: [addr(1, { is_default: true })], preview: { delivery_from: null, delivered_from: null, deferred: false, source: null, delivery: NEEDS } })
    renderPage()
    await screen.findByText('AK-039-5028')
    await chooseWallet()
    await waitFor(() => expect(placeButton()).toBeEnabled())
    expect(screen.queryByText(PIN_MESSAGE)).not.toBeInTheDocument()
    fireEvent.click(placeButton())
    await waitFor(() => expect(seen.checkout).toHaveLength(1))
    expect(seen.checkout[0]).toMatchObject({ delivery_lat: 6.6882, delivery_lng: -1.6244 })
  })

  test('test_a_typed_address_needs_the_pin_with_promotions_on_too', async () => {
    serve({ promos: true, quote: (body) => HttpResponse.json({ enabled: true, total: '300.00', delivery: body.delivery_lat ? FEE : NEEDS }) })
    renderPage()
    await fillManual()
    expect(await screen.findByText(PIN_MESSAGE)).toBeInTheDocument()
    expect(placeButton()).toBeDisabled()
    fireEvent.click(await screen.findByText('drop-pin'))
    await waitFor(() => expect(placeButton()).toBeEnabled())
  })

  test('test_with_fees_off_no_pin_is_required_and_the_fee_row_says_no_delivery_fee', async () => {
    serve({ addresses: [addr(1, { is_default: true, lat: null, lng: null })] }) // preview answers delivery: null
    renderPage()
    await screen.findByText('AK-039-5028')
    await chooseWallet()
    await waitFor(() => expect(placeButton()).toBeEnabled())
    expect(screen.getByTestId('summary-delivery')).toHaveTextContent('No delivery fee')
    expect(screen.queryByText(PIN_MESSAGE)).not.toBeInTheDocument()
  })

  test('test_the_quantity_plus_stops_at_the_counted_stock', async () => {
    const cart = { ...CART, items: [{ ...CART.items[0], quantity: 2, stock_quantity: 2 }] }
    serve({ cart, addresses: [addr(1, { is_default: true })] })
    renderPage()
    await screen.findByText('AK-039-5028')
    expect(await screen.findByRole('button', { name: 'Increase quantity of Kente Stole' })).toBeDisabled()
  })
})
