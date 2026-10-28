import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import BusinessCommandCenter from '../../BusinessCommandCenter.jsx'
import { server } from '../../../../mocks/server.js'
import VendorMoney from '../VendorMoney.jsx'

const API = 'http://localhost:8000'
const wrap = (ui) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}
const overview = (over = {}) => server.use(
  http.get(`${API}/api/wallet/`, () => HttpResponse.json({ kind: 'vendor', pending: '120.00', available: '48.50' })),
  http.get(`${API}/api/wallet/vendor/`, () => HttpResponse.json({
    pending: '120.00', available: '48.50', withdrawable: '40.00', negative: false, awaiting_call: 3,
    fee_cap: { limit: null, used: '0.00', remaining: null }, withdrawing: '0.00', ...over,
  })),
)
const off = () => server.use(
  http.get(`${API}/api/wallet/`, () => HttpResponse.json({ code: 'ledger_off', detail: 'off' }, { status: 409 })),
  http.get(`${API}/api/wallet/vendor/`, () => HttpResponse.json({ code: 'ledger_off', detail: 'off' }, { status: 409 })),
)
const amountOf = (text) => screen.getByText(text).closest('[data-amount]') || screen.getByText(text)

describe('MoneyOverview', () => {
  it('test_ledger_off_shows_one_line_and_no_sub_tabs', async () => {
    off()
    wrap(<VendorMoney businessKind="product" />)
    expect(await screen.findByText("Wallets aren't switched on yet.")).toBeInTheDocument()
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
    expect(screen.queryByRole('tab')).not.toBeInTheDocument()
  })

  it('test_overview_shows_pending_available_and_withdrawable_as_sent', async () => {
    overview()
    wrap(<VendorMoney businessKind="product" />)
    expect(await screen.findByText('GH₵ 120.00')).toBeInTheDocument()
    expect(screen.getByText('GH₵ 48.50')).toBeInTheDocument()
    expect(screen.getByText('Can be withdrawn now')).toBeInTheDocument()
    const w = await screen.findByText('GH₵ 40.00')
    expect(w.closest('[data-amount]')).not.toBeNull()
    expect(screen.getByRole('tab', { name: 'Overview', selected: true })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Payouts' })).toBeInTheDocument()
  })

  it('test_withdrawing_line_only_for_a_non_zero_server_amount', async () => {
    overview({ withdrawing: '0.00' })
    const first = wrap(<VendorMoney businessKind="product" />)
    await screen.findByText('Can be withdrawn now')
    expect(screen.queryByText('On its way to your payout number')).not.toBeInTheDocument()
    first.unmount()
    overview({ withdrawing: '15.25' })
    wrap(<VendorMoney businessKind="product" />)
    expect(await screen.findByText('On its way to your payout number')).toBeInTheDocument()
    expect(screen.getByText('GH₵ 15.25')).toBeInTheDocument()
  })

  it('test_awaiting_count_is_the_servers', async () => {
    overview({ awaiting_call: 7 })
    wrap(<VendorMoney businessKind="product" />)
    const label = await screen.findByText('Sales waiting to be released')
    expect(label.parentElement).toHaveTextContent('7')
  })

  it('test_cap_meter_shows_used_limit_and_remaining_as_sent', async () => {
    overview({ fee_cap: { limit: '100.00', used: '25.00', remaining: '75.00' } })
    wrap(<VendorMoney businessKind="product" />)
    expect(await screen.findByText(/Platform fees so far:/)).toHaveTextContent(
      'Platform fees so far: GH₵ 25.00 of your GH₵ 100.00 lifetime cap. GH₵ 75.00 left.',
    )
  })

  it('test_meter_width_comes_from_the_two_server_amounts', async () => {
    overview({ fee_cap: { limit: '100.00', used: '25.00', remaining: '75.00' } })
    wrap(<VendorMoney businessKind="product" />)
    const meter = await screen.findByRole('meter', { name: 'Lifetime fee cap used' })
    expect(meter).toHaveAttribute('aria-valuemin', '0')
    expect(meter).toHaveAttribute('aria-valuemax', '10000')
    expect(meter).toHaveAttribute('aria-valuenow', '2500')
    expect(meter.firstChild.style.width).toBe('25%')
  })

  it('test_no_cap_says_so_and_draws_no_meter', async () => {
    overview({ fee_cap: { limit: null, used: '12.00', remaining: null } })
    wrap(<VendorMoney businessKind="product" />)
    expect(await screen.findByText(/No lifetime cap on platform fees\./)).toHaveTextContent('No lifetime cap on platform fees. Fees so far: GH₵ 12.00.')
    expect(screen.queryByRole('meter')).not.toBeInTheDocument()
  })

  it('test_cap_reached_says_no_more_fees', async () => {
    overview({ fee_cap: { limit: '100.00', used: '100.00', remaining: '0.00' } })
    wrap(<VendorMoney businessKind="product" />)
    expect(await screen.findByText('You have reached your cap: no more platform fees are taken.')).toBeInTheDocument()
    expect((await screen.findByRole('meter')).firstChild.style.width).toBe('100%')
  })

  it('test_withdraw_button_opens_the_payouts_sub_tab', async () => {
    overview()
    wrap(<VendorMoney businessKind="product" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Withdraw or manage payout numbers' }))
    expect(await screen.findByText('Withdrawals go only to a payout number whose account name matches your registered name.')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Payouts', selected: true })).toBeInTheDocument()
  })

  it('test_when_you_get_paid_uses_the_servers_hours', async () => {
    overview()
    server.use(http.get(`${API}/api/ledger/booking-terms/`, () => HttpResponse.json({
      enabled: true, service_auto_accept_hours: 72, stay_issue_window_hours: 36, event_release_delay_hours: 96, stay_check_in_time: '15:00', policies: {},
    })))
    wrap(<VendorMoney businessKind="product" />)
    expect(await screen.findByText(/Services: when the customer accepts, or 72 hours after you mark the job done\./)).toBeInTheDocument()
    expect(screen.getByText(/Stays: 36 hours after the guest's check-in time \(15:00\)\./)).toBeInTheDocument()
    expect(screen.getByText(/Event tickets: 96 hours after the end of the event day\./)).toBeInTheDocument()
    expect(screen.getByText(/Product orders: after AshantiHub Support calls the customer/)).toBeInTheDocument()
    expect(screen.queryByText(/48 hours/)).not.toBeInTheDocument()
  })

  it('test_when_you_get_paid_renders_nothing_when_terms_are_disabled', async () => {
    overview()
    server.use(http.get(`${API}/api/ledger/booking-terms/`, () => HttpResponse.json({ enabled: false })))
    wrap(<VendorMoney businessKind="product" />)
    await screen.findByText('Can be withdrawn now')
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByText(/Product orders:/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Event tickets:/)).not.toBeInTheDocument()
  })
})

describe('BusinessCommandCenter Money tab', () => {
  const owner = { id: 7, fullName: 'Abena', accountType: 'business_owner', kycStatus: 'verified' }
  const auth = { refreshUser: vi.fn().mockResolvedValue({}), logout: vi.fn() }
  const mount = () => {
    overview()
    server.use(
      http.get(`${API}/api/listings/mine/`, () => HttpResponse.json([])),
      http.get(`${API}/api/accounts/business-owners/me/profile/`, () => HttpResponse.json({ ghana_card_number: 'GHA-1', business_kind: 'product', has_hours: true })),
      http.get(`${API}/api/billing/plans/`, () => HttpResponse.json([])),
      http.get(`${API}/api/billing/subscriptions/me/`, () => HttpResponse.json({})),
      http.get(`${API}/api/hero/mine/`, () => HttpResponse.json({})),
    )
    return wrap(<BusinessCommandCenter user={owner} auth={auth} onExit={vi.fn()} />)
  }

  it('test_one_money_tab_after_payments_and_no_payouts_tab', async () => {
    mount()
    const nav = (await screen.findByRole('button', { name: /💳 Payments/ })).closest('nav')
    const names = within(nav).getAllByRole('button').map((b) => b.textContent.trim())
    const i = names.findIndex((n) => /Payments$/.test(n))
    expect(names.filter((n) => /Money$/.test(n))).toHaveLength(1)
    expect(names[i + 1]).toMatch(/Money$/)
    expect(names.some((n) => /Payouts/.test(n))).toBe(false)
  })

  it('test_payouts_sub_tab_mounts_3f_vendor_payouts', async () => {
    mount()
    fireEvent.click(await screen.findByRole('button', { name: /💰 Money/ }))
    expect(await screen.findByText('Can be withdrawn now')).toBeInTheDocument()
    expect(screen.queryByText(/payout number whose account name matches/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Payouts' }))
    expect(await screen.findByText(/payout number whose account name matches your registered name/)).toBeInTheDocument()
  })
})
