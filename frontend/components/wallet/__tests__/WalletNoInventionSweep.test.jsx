import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { server } from '../../../mocks/server.js'
import TopUpDialog from '../../account/wallet/TopUpDialog.jsx'
import WalletAccounts from '../../account/wallet/WalletAccounts.jsx'
import WalletSettings from '../../account/wallet/WalletSettings.jsx'
import WalletOverview from '../../account/wallet/WalletOverview.jsx'
import WalletTransactions from '../../account/wallet/WalletTransactions.jsx'
import WalletsPanel from '../../admin/panels/WalletsPanel.jsx'
import WithdrawalsPanel from '../../admin/panels/WithdrawalsPanel.jsx'
import BalanceSummary from '../BalanceSummary.jsx'
import DestinationsList from '../DestinationsList.jsx'
import PaymentMethodPicker from '../PaymentMethodPicker.jsx'
import TopUpForm from '../TopUpForm.jsx'
import TransactionsList from '../TransactionsList.jsx'
import VendorPayouts from '../VendorPayouts.jsx'
import WithdrawForm from '../WithdrawForm.jsx'
import WithdrawalHistory from '../WithdrawalHistory.jsx'

// Conformance sweep (Plan 3F, Task 10): every wallet screen, rendered with the
// default "ledger on, empty" data and again with populated data, must hold the
// money and no-invention rules. Amount elements carry no test marker in
// production code, so an amount is any element whose own text is exactly one
// formatted amount ("GH₵ 12.50", optionally signed).

const API = 'http://localhost:8000'
const GOLD = /#d4a017/i
const AMOUNT_TEXT = /^[+−-]?GH₵ [\d,]+\.\d{2}$/
const envelope = (results) => HttpResponse.json({ count: results.length, next: null, previous: null, results })
const wrap = (ui) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>,
)
const ownText = (el) => Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim()

const dest = { id: 7, rail: 'momo', institution: 'MTN', account_name: 'Akosua Ntoma', account_number_masked: '024****567', usable_from: '2026-10-01T10:00:00Z', usable: true, removed: false }
const wd = { id: 1, reference: 'WD-1', amount: '100.00', charge: '1.00', you_receive: '99.00', status: 'processing', status_label: 'Processing', destination: dest, created_at: '2026-10-20T10:05:00Z', settled_at: null, failure_reason: '' }
const tx = (o) => ({ id: 1, at: '2026-10-18T10:30:00+00:00', account: 'wallet', kind: 'wallet_top_up', label: 'Top-up', direction: 'in', amount: '20.00', order: null, booking_sale: null, reference: '', ...o })
const staffWd = { ...wd, status: 'sent', status_label: 'Sent to provider', destination: { account_number_masked: '024****789', network: 'MTN' }, holder_type: 'customer', holder_id: 1, holder_name: 'Ama Mensah', provider: 'hubtel', provider_reference: '', submitted_at: '2026-10-20T10:06:00Z', stuck: true }
const customerWallet = () => server.use(http.get(`${API}/api/wallet/`, () => HttpResponse.json({ kind: 'customer', balance: '1250.50' })))
const vendorWallet = () => server.use(
  http.get(`${API}/api/wallet/`, () => HttpResponse.json({ kind: 'vendor', pending: '12.00', available: '48.50' })),
  http.get(`${API}/api/wallet/vendor/`, () => HttpResponse.json({ pending: '12.00', available: '48.50', withdrawable: '48.50', negative: false, awaiting_call: false, fee_cap: '0.00' })),
)
const customerData = () => {
  customerWallet()
  server.use(
    http.get(`${API}/api/wallet/transactions/`, () => envelope([tx({ id: 1 }), tx({ id: 2, kind: 'order_payment', label: 'Order payment', direction: 'out', amount: '7.50', order: 42 })])),
    http.get(`${API}/api/wallet/destinations/`, () => HttpResponse.json({ results: [dest], cooling_hours: 24 })),
    http.get(`${API}/api/wallet/withdrawals/`, () => envelope([wd])),
  )
}

const scenarios = [
  ['TopUpForm', null, () => <TopUpForm />, /Amount to add/],
  ['BalanceSummary', customerWallet, () => <BalanceSummary />, /1,250\.50/],
  ['BalanceSummary (dashboard)', vendorWallet, () => <BalanceSummary tone="dashboard" />, /48\.50/],
  ['TransactionsList', customerData, () => <TransactionsList orderHref={(id) => `/orders/${id}`} />, 'Order payment'],
  ['DestinationsList', customerData, () => <DestinationsList />, /Akosua Ntoma/],
  ['WithdrawForm', customerData, () => <WithdrawForm />, /amount to withdraw/i],
  ['WithdrawalHistory', customerData, () => <WithdrawalHistory />, 'Processing'],
  ['PaymentMethodPicker', customerWallet, () => <PaymentMethodPicker amount="30.00" />, /AshantiHub wallet/],
  ['VendorPayouts', vendorWallet, () => <VendorPayouts />, 'Pending'],
  ['WalletOverview', customerData, () => <MemoryRouter><WalletOverview /></MemoryRouter>, 'Order payment'],
  ['WalletTransactions', customerData, () => <MemoryRouter><WalletTransactions /></MemoryRouter>, 'Order payment'],
  ['WalletAccounts', customerData, () => <MemoryRouter><WalletAccounts /></MemoryRouter>, 'Processing'],
  ['WalletSettings', null, () => <MemoryRouter><WalletSettings /></MemoryRouter>, 'Your default purchase preference'],
  ['TopUpDialog', null, () => <TopUpDialog onClose={() => {}} />, /Amount to add/],
  ['WalletsPanel', () => server.use(http.get(`${API}/api/wallet/staff/wallets/`, () => envelope([{ holder_id: 1, name: 'Ama Mensah', balance: '25.50' }]))), () => <WalletsPanel />, 'Ama Mensah'],
  ['WithdrawalsPanel', () => server.use(http.get(`${API}/api/wallet/staff/withdrawals/`, () => envelope([staffWd]))), () => <WithdrawalsPanel auth={{ hasPermission: () => true }} />, 'WD-1'],
]
// Default ("ledger on, empty") renders: wait for the same ready text where the
// screen has one without data, otherwise just let the queries settle.
const emptyReady = {
  TopUpForm: /Amount to add/, TopUpDialog: /Amount to add/, WithdrawForm: null, VendorPayouts: null, PaymentMethodPicker: null,
}

function sweep(container) {
  const html = container.innerHTML
  const text = container.textContent
  expect(container.querySelectorAll('a[href^="tel:"]').length).toBe(0)
  expect(html).not.toMatch(/wa\.me/)
  expect(text).not.toMatch(/card number|CVV|expiry/i)
  expect(text).not.toContain('1.5%')
  expect(text).not.toMatch(/NaN|undefined/)
  let amounts = 0
  container.querySelectorAll('*').forEach((el) => {
    const own = ownText(el)
    expect(own, `bare digit run in <${el.tagName.toLowerCase()}>`).not.toMatch(/^\d{10,}$/)
    if (AMOUNT_TEXT.test(own)) {
      amounts += 1
      const style = el.getAttribute('style') || ''
      expect(style, `amount "${own}" needs tabular-nums`).toMatch(/font-variant-numeric:\s*tabular-nums/i)
      expect(style, `amount "${own}" must not be gold`).not.toMatch(GOLD)
      expect(style, `amount "${own}" must carry a colour`).toMatch(/color:/i)
    }
  })
  return amounts
}

describe('wallet screens conformance sweep', () => {
  describe.each(scenarios)('%s', (name, setup, ui, ready) => {
    it('populated: holds the money and no-invention rules', async () => {
      if (setup) setup()
      const { container } = wrap(ui())
      await screen.findByText(ready)
      await waitFor(() => expect(container.textContent.length).toBeGreaterThan(0))
      sweep(container)
    })

    it('default ledger-on-empty data: holds the same rules', async () => {
      const { container } = wrap(ui())
      if (emptyReady[name]) await screen.findByText(emptyReady[name])
      else await new Promise((r) => setTimeout(r, 60))
      sweep(container)
    })
  })

  it('finds amount elements in the populated screens (the sweep is not vacuous)', async () => {
    customerData()
    const { container } = wrap(<><TransactionsList /><WithdrawalHistory /></>)
    await screen.findByText('Processing')
    expect(sweep(container)).toBeGreaterThanOrEqual(4)
  })
})
