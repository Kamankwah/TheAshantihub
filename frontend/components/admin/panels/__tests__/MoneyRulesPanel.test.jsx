import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../../../mocks/server.js'
import MoneyRulesPanel from '../MoneyRulesPanel.jsx'

const API = 'http://localhost:8000'
const setting = (key, label, value, extra = {}) => ({
  key, label, value, default: value, is_default: true, nullable: false, minimum: 0, maximum: 10 ** 10, scheduled: [], ...extra,
})
const SETTINGS = {
  settings: [
    setting('fee_cap_pesewas', 'Lifetime platform-fee cap per vendor', null, { nullable: true }),
    setting('verification_overdue_hours', 'Hours by which an order must be verified', 72),
    setting('event_release_delay_hours', 'Hours after an event ends before its ticket money is released', 48),
    setting('withdrawal_per_tx_limit_pesewas', 'Largest single withdrawal', 500000, { is_default: false }),
    setting('brand_new_key', 'A setting this page has no group for', 5),
  ],
  pending: [],
  history: [],
}
const FEES = {
  current: [
    { category: 'product', label: 'Products', effective_from: '2020-01-01T00:00:00Z', bands: [
      { lower: 0, upper: 9999, percent_bp: 100, flat: null },
      { lower: 10000, upper: null, percent_bp: null, flat: 500 },
    ] },
    { category: 'service', label: 'Services', effective_from: '2026-10-18T00:00:00Z', bands: [{ lower: 0, upper: null, percent_bp: 200, flat: null }] },
    { category: 'event', label: 'Events', effective_from: '2026-10-18T00:00:00Z', bands: [{ lower: 0, upper: null, percent_bp: 300, flat: null }] },
  ],
  pending: [],
  history: [],
}

function renderPanel({ settings = SETTINGS, fees = FEES } = {}) {
  server.use(
    http.get(`${API}/api/ledger/settings/`, () => HttpResponse.json(settings)),
    http.get(`${API}/api/ledger/fees/`, () => HttpResponse.json(fees)),
  )
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={queryClient}><MoneyRulesPanel /></QueryClientProvider>)
}

describe('MoneyRulesPanel settings', () => {
  it('shows every setting under its group, with amounts in cedis, and an Other group for unknown keys', async () => {
    renderPanel()
    expect(await screen.findByLabelText('Largest single withdrawal')).toHaveValue('5000.00')
    expect(screen.getByLabelText('Hours by which an order must be verified')).toHaveValue('72')
    expect(screen.getByRole('heading', { name: 'When money is released' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Other' })).toBeInTheDocument()
    expect(screen.getByLabelText('A setting this page has no group for')).toBeInTheDocument()
    expect(screen.getByLabelText('Lifetime platform-fee cap per vendor')).toHaveValue('')
    expect(screen.getByText('No limit')).toBeInTheDocument()
  })

  it('says "built-in default" only where nobody has set a value', async () => {
    renderPanel()
    await screen.findByLabelText('Largest single withdrawal')
    const row = (label) => screen.getByLabelText(label).closest('[data-setting]')
    expect(within(row('Hours by which an order must be verified')).getByText('Built-in default')).toBeInTheDocument()
    expect(within(row('Largest single withdrawal')).queryByText('Built-in default')).toBeNull()
  })

  it('sends the edited value in the server unit and says it was applied', async () => {
    let sent = null
    server.use(http.post(`${API}/api/ledger/settings/`, async ({ request }) => { sent = await request.json(); return HttpResponse.json({ approval_id: 3, status: 'approved' }, { status: 201 }) }))
    renderPanel()
    const input = await screen.findByLabelText('Largest single withdrawal')
    fireEvent.change(input, { target: { value: '3,000.50' } })
    fireEvent.click(within(input.closest('[data-setting]')).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(sent).toEqual({ key: 'withdrawal_per_tx_limit_pesewas', value: 300050 }))
    expect(await screen.findByText('Applied.')).toBeInTheDocument()
  })

  it('says a change is waiting for approval when someone other than a Super Admin makes it', async () => {
    server.use(http.post(`${API}/api/ledger/settings/`, () => HttpResponse.json({ approval_id: 4, status: 'pending' }, { status: 201 })))
    renderPanel()
    const input = await screen.findByLabelText('Hours by which an order must be verified')
    fireEvent.change(input, { target: { value: '48' } })
    fireEvent.click(within(input.closest('[data-setting]')).getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Sent for approval.')).toBeInTheDocument()
  })

  it('shows the server message beside the field when a change is refused', async () => {
    server.use(http.post(`${API}/api/ledger/settings/`, () => HttpResponse.json({ detail: 'A change to this setting is already waiting for approval.' }, { status: 409 })))
    renderPanel()
    const input = await screen.findByLabelText('Hours by which an order must be verified')
    fireEvent.change(input, { target: { value: '24' } })
    fireEvent.click(within(input.closest('[data-setting]')).getByRole('button', { name: 'Save' }))
    expect(await within(input.closest('[data-setting]')).findByRole('alert')).toHaveTextContent('already waiting for approval')
  })

  it('does not send a value that is not a number', async () => {
    let called = false
    server.use(http.post(`${API}/api/ledger/settings/`, () => { called = true; return HttpResponse.json({}, { status: 201 }) }))
    renderPanel()
    const input = await screen.findByLabelText('Hours by which an order must be verified')
    fireEvent.change(input, { target: { value: 'abc' } })
    fireEvent.click(within(input.closest('[data-setting]')).getByRole('button', { name: 'Save' }))
    expect(await within(input.closest('[data-setting]')).findByRole('alert')).toHaveTextContent('whole number')
    expect(called).toBe(false)
  })

  it('shows a waiting request and a scheduled change on the row', async () => {
    renderPanel({ settings: {
      ...SETTINGS,
      settings: SETTINGS.settings.map((s) => (s.key === 'verification_overdue_hours' ? { ...s, scheduled: [{ value: 96, effective_from: '2026-11-01T00:00:00Z' }] } : s)),
      pending: [{ id: 9, key: 'verification_overdue_hours', value: 60, maker: 'Kofi Mensah', created_at: '2026-10-18T10:00:00Z' }],
    } })
    const row = (await screen.findByLabelText('Hours by which an order must be verified')).closest('[data-setting]')
    expect(within(row).getByText(/Waiting for approval: 60 hours, proposed by Kofi Mensah/)).toBeInTheDocument()
    expect(within(row).getByText(/Scheduled: 96 hours from/)).toBeInTheDocument()
  })

  it('shows a waiting money change in cedis, the server already sending it in pesewas', async () => {
    renderPanel({ settings: { ...SETTINGS, pending: [{ id: 10, key: 'withdrawal_per_tx_limit_pesewas', value: 250000, maker: 'Kofi Mensah', created_at: '2026-10-18T10:00:00Z' }] } })
    const row = (await screen.findByLabelText('Largest single withdrawal')).closest('[data-setting]')
    expect(within(row).getByText(/Waiting for approval: GH₵ 2,500.00, proposed by Kofi Mensah/)).toBeInTheDocument()
  })

  it('shows an error when the settings cannot be loaded', async () => {
    server.use(http.get(`${API}/api/ledger/settings/`, () => HttpResponse.json({}, { status: 500 })), http.get(`${API}/api/ledger/fees/`, () => HttpResponse.json(FEES)))
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={queryClient}><MoneyRulesPanel /></QueryClientProvider>)
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load')
  })
})

describe('MoneyRulesPanel fee tiers', () => {
  it('shows each category with its tiers in cedis and percent', async () => {
    renderPanel()
    const products = (await screen.findByRole('heading', { name: 'Products' })).closest('[data-fees]')
    expect(within(products).getByText('GH₵ 0.00 – GH₵ 99.99')).toBeInTheDocument()
    expect(within(products).getByText('1%')).toBeInTheDocument()
    expect(within(products).getByText('GH₵ 100.00 and above')).toBeInTheDocument()
    expect(within(products).getByText('GH₵ 5.00')).toBeInTheDocument()
  })

  it('proposes a new ladder in pesewas with each tier starting right after the one before', async () => {
    let sent = null
    server.use(http.post(`${API}/api/ledger/fees/`, async ({ request }) => { sent = await request.json(); return HttpResponse.json({ approval_id: 5, status: 'pending' }, { status: 201 }) }))
    renderPanel()
    const events = (await screen.findByRole('heading', { name: 'Events' })).closest('[data-fees]')
    fireEvent.click(within(events).getByRole('button', { name: 'Edit tiers' }))
    fireEvent.change(within(events).getByLabelText('Tier 1 up to (GH₵)'), { target: { value: '99.99' } })
    fireEvent.change(within(events).getByLabelText('Tier 1 amount'), { target: { value: '3.5' } })
    fireEvent.click(within(events).getByRole('button', { name: 'Add tier' }))
    fireEvent.change(within(events).getByLabelText('Tier 2 amount'), { target: { value: '2' } })
    fireEvent.click(within(events).getByRole('button', { name: 'Propose these tiers' }))
    await waitFor(() => expect(sent).toEqual({ category: 'event', bands: [
      { lower: 0, upper: 9999, percent_bp: 350, flat: null },
      { lower: 10000, upper: null, percent_bp: 200, flat: null },
    ] }))
    expect(await within(events).findByText('Sent for approval.')).toBeInTheDocument()
  })

  it('shows the server message when a ladder is refused', async () => {
    server.use(http.post(`${API}/api/ledger/fees/`, () => HttpResponse.json({ detail: 'Fee bands must start at 0 and follow one another with no gap or overlap' }, { status: 400 })))
    renderPanel()
    const services = (await screen.findByRole('heading', { name: 'Services' })).closest('[data-fees]')
    fireEvent.click(within(services).getByRole('button', { name: 'Edit tiers' }))
    fireEvent.click(within(services).getByRole('button', { name: 'Propose these tiers' }))
    expect(await within(services).findByRole('alert')).toHaveTextContent('no gap or overlap')
  })

  it('refuses a last tier that has an upper limit before sending anything', async () => {
    let called = false
    server.use(http.post(`${API}/api/ledger/fees/`, () => { called = true; return HttpResponse.json({}, { status: 201 }) }))
    renderPanel()
    const services = (await screen.findByRole('heading', { name: 'Services' })).closest('[data-fees]')
    fireEvent.click(within(services).getByRole('button', { name: 'Edit tiers' }))
    fireEvent.change(within(services).getByLabelText('Tier 1 up to (GH₵)'), { target: { value: '500' } })
    fireEvent.click(within(services).getByRole('button', { name: 'Propose these tiers' }))
    expect(await within(services).findByRole('alert')).toHaveTextContent('last tier must have no upper limit')
    expect(called).toBe(false)
  })

  it('shows a ladder already waiting for approval', async () => {
    renderPanel({ fees: { ...FEES, pending: [{ id: 2, category: 'event', maker: 'Kofi Mensah', created_at: '2026-10-18T10:00:00Z', effective_from: null, bands: [{ lower: 0, upper: null, percent_bp: 250, flat: null }] }] } })
    const events = (await screen.findByRole('heading', { name: 'Events' })).closest('[data-fees]')
    expect(within(events).getByText(/Waiting for approval, proposed by Kofi Mensah/)).toBeInTheDocument()
  })
})
