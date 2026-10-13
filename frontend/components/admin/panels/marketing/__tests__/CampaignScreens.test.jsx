import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { server } from '../../../../../mocks/server.js'
import TrackedLinkPage, { safePath } from '../../../../TrackedLinkPage.jsx'
import CampaignCalendarPanel from '../CampaignCalendarPanel.jsx'
import CampaignResultsPanel from '../CampaignResultsPanel.jsx'
import CampaignsPanel from '../CampaignsPanel.jsx'
import NewCampaignPanel from '../NewCampaignPanel.jsx'
import SenderIdsPanel from '../SenderIdsPanel.jsx'
import TemplatesPanel from '../TemplatesPanel.jsx'
import { API, renderMk } from './mkTestUtils.jsx'

vi.setConfig({ testTimeout: 20000 })

const campaign = (o = {}) => ({ id: 1, name: 'Kente Friday', channel: 'sms', channel_label: 'SMS', status: 'draft', status_label: 'Draft', segment: 3, segment_name: 'Adum customers', est_recipients: 1240, est_cost: '40.92', cost_known: true, send_at: '2026-10-20T09:00:00Z', sent_at: null, note: '', results: null, free_channel: false, ...o })
const list = (rows, tabs = {}) => ({ results: rows, total: rows.length, tabs: { draft: 0, waiting_approval: 0, scheduled: 0, sent: 0, ...tabs }, sms_month_estimate: '6.60', sms_balance: null, sms_note: 'No SMS provider is connected, so there is no real balance or bill to show.' })

describe('CampaignsPanel', () => {
  it('lists campaigns, says there is no balance, and shows the approval trail for one waiting', async () => {
    const waiting = campaign({ id: 2, name: 'Big send', status: 'waiting_approval', status_label: 'Waiting for Super Admin' })
    let reminded = false
    server.use(
      http.get(`${API}/api/marketing/campaigns/`, () => HttpResponse.json(list([campaign(), waiting], { draft: 1, waiting_approval: 1 }))),
      http.get(`${API}/api/marketing/campaigns/2/`, () => HttpResponse.json({ ...waiting, trail: [{ at: '2026-10-13T10:12:00Z', text: 'Sent for approval', who: 'Akua' }] })),
      http.post(`${API}/api/marketing/campaigns/2/remind/`, () => { reminded = true; return HttpResponse.json({ reminded: true }) }),
    )
    renderMk(CampaignsPanel, { permissions: ['campaigns.manage'] })
    expect(await screen.findByText(/no real balance or bill/)).toBeInTheDocument()
    expect(screen.getAllByText('Adum customers').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: 'Big send' }))
    expect(await screen.findByText('Sent for approval')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Remind Super Admin' }))
    await waitFor(() => expect(reminded).toBe(true))
  })
  it('shows an honest empty state', async () => {
    server.use(http.get(`${API}/api/marketing/campaigns/`, () => HttpResponse.json(list([]))))
    renderMk(CampaignsPanel, { permissions: ['campaigns.manage'] })
    expect(await screen.findByText(/No campaign yet/)).toBeInTheDocument()
  })
})

describe('NewCampaignPanel', () => {
  const est = (o = {}) => ({ recipients: 1240, matched: 1271, left_out_cap: 12, left_out_no_opt_in: 19, sms_segments: 1, cost: '40.92', cost_known: true, threshold: '25.00', needs_approval: true, checks: [{ key: 'consent', title: 'Consent', detail: 'all 1,240 have SMS opt-in on record', state: 'ok' }, { key: 'provider', title: 'Provider', detail: 'SMS is not connected, so this can be saved as a draft but not sent.', state: 'block' }], length: 120, preview: 'Hello Stop: x', unit_price: '0.033', ...o })
  const setup = (extra = []) => server.use(
    http.get(`${API}/api/marketing/segments/`, () => HttpResponse.json({ results: [{ id: 3, name: 'Adum customers', audience_label: 'Customers' }] })),
    http.get(`${API}/api/marketing/providers/`, () => HttpResponse.json({ sms: { status: 'not_connected' }, whatsapp: { status: 'not_connected' }, email: { status: 'simulated' }, inapp: { status: 'connected' } })),
    http.get(`${API}/api/marketing/templates/`, () => HttpResponse.json({ sms: [], whatsapp: [] })),
    http.post(`${API}/api/marketing/campaigns/estimate/`, () => HttpResponse.json(est())),
    ...extra,
  )
  it('shows the server checks, the approval need and what is not connected; the button says it goes to Super Admin', async () => {
    setup()
    renderMk(NewCampaignPanel, { permissions: ['campaigns.manage'] })
    fireEvent.change(await screen.findByLabelText('Audience'), { target: { value: '3' } })
    expect(await screen.findByText(/1,240 people will get this/, {}, { timeout: 5000 })).toBeInTheDocument()
    expect(screen.getByText(/not connected, so this can be saved as a draft but not sent/)).toBeInTheDocument()
    expect(screen.getByText(/must approve it/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send to Super Admin for approval' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^SMS Not connected/ })).toBeInTheDocument()
  })
  it('saves a draft with the send time and the audience', async () => {
    let body = null
    setup([http.post(`${API}/api/marketing/campaigns/`, async ({ request }) => { body = await request.json(); return HttpResponse.json({ id: 9 }, { status: 201 }) })])
    renderMk(NewCampaignPanel, { permissions: ['campaigns.manage'] })
    fireEvent.change(await screen.findByLabelText(/Campaign name/), { target: { value: 'Kente Friday' } })
    fireEvent.change(screen.getByLabelText('Audience'), { target: { value: '3' } })
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Hello {link}' } })
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-10-20' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }))
    await waitFor(() => expect(body).toMatchObject({ name: 'Kente Friday', channel: 'sms', segment: 3, body: 'Hello {link}', send_at: '2026-10-20T10:00:00+00:00' }))
  })
})

describe('CampaignCalendarPanel', () => {
  it('shows quiet days, entries and real overlaps', async () => {
    const now = new Date()
    const day = (n) => new Date(now.getFullYear(), now.getMonth(), n, 12).toISOString()
    const key = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-02`
    server.use(http.get(`${API}/api/marketing/calendar/`, () => HttpResponse.json({
      entries: [{ id: 1, kind: 'message', channel: 'sms', title: 'Lunch deals', starts_at: day(10), ends_at: null, status: 'scheduled' }, { id: 4, kind: 'banner', title: 'Kente hero', starts_at: day(10), ends_at: day(12), status: 'live' }],
      quiet_days: [{ date: key, why: 'Quiet day' }], clashes: [{ when: 'Tue 13 Oct', text: '212 of them are also in the first campaign.' }],
      window: { window_start: '08:00', window_end: '19:00', send_day_names: ['Mon', 'Tue'] },
    })))
    renderMk(CampaignCalendarPanel, { permissions: ['campaigns.manage'] })
    expect(await screen.findByText(/SMS .*Lunch deals/)).toBeInTheDocument()
    expect(screen.getAllByText(/Banner · Kente hero/).length).toBeGreaterThan(0)
    expect(screen.getByText(/212 of them are also/)).toBeInTheDocument()
    expect(screen.getAllByText('Quiet day').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByLabelText(/Banners/))
    expect(screen.queryByText(/Banner · Kente hero/)).toBeNull()
  })
})

describe('TemplatesPanel', () => {
  const wa = (o) => ({ id: 1, channel: 'whatsapp', name: 'weekend_deals', body: 'Hello', category: 'marketing', buttons: ['Stop offers'], meta_status: 'not_submitted', meta_note: '', meta_recorded_by: null, meta_recorded_at: null, used: 0, can_use: false, ...o })
  it('records what Meta answered, by hand, and says WhatsApp is not connected', async () => {
    let posted = null
    server.use(
      http.get(`${API}/api/marketing/templates/`, () => HttpResponse.json({ sms: [], whatsapp: [wa()], whatsapp_counts: { approved: 0, waiting: 0, rejected: 0, not_submitted: 1 }, whatsapp_provider: { status: 'not_connected' }, sms_provider: { status: 'not_connected' }, stop_footer_length: 34 })),
      http.post(`${API}/api/marketing/templates/1/meta/`, async ({ request }) => { posted = await request.json(); return HttpResponse.json(wa({ meta_status: 'rejected' })) }),
    )
    renderMk(TemplatesPanel, { permissions: ['campaigns.manage'] })
    expect(await screen.findByText(/WhatsApp: not connected/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: "Record Meta's answer" }))
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'rejected' } })
    fireEvent.change(screen.getByLabelText(/Note/), { target: { value: 'Variable first' } })
    fireEvent.click(screen.getByRole('button', { name: 'Record' }))
    await waitFor(() => expect(posted).toEqual({ status: 'rejected', note: 'Variable first' }))
  })
  it('shows the server refusal for a template that breaks a rule', async () => {
    server.use(
      http.get(`${API}/api/marketing/templates/`, () => HttpResponse.json({ sms: [], whatsapp: [], whatsapp_counts: { approved: 0, waiting: 0, rejected: 0, not_submitted: 0 }, whatsapp_provider: { status: 'not_connected' }, sms_provider: { status: 'not_connected' }, stop_footer_length: 34 })),
      http.post(`${API}/api/marketing/templates/`, () => HttpResponse.json({ detail: 'Every marketing template must carry a "Stop offers" button.' }, { status: 400 })),
    )
    renderMk(TemplatesPanel, { permissions: ['campaigns.manage'] })
    fireEvent.click(await screen.findByRole('button', { name: 'New WhatsApp template' }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'x' } })
    fireEvent.change(screen.getByLabelText(/^Text/), { target: { value: 'Hello there' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save template' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Stop offers')
  })
})

describe('SenderIdsPanel', () => {
  it('shows nothing connected as connected and records a sender ID by hand', async () => {
    let posted = null
    server.use(
      http.get(`${API}/api/marketing/providers/`, () => HttpResponse.json({
        sms: { status: 'not_connected', note: 'SMS is not connected, so nothing can be sent.', balance_note: 'No SMS provider is connected, so there is no balance.', price: '0.033', delivery_reports: false },
        senders: [], networks: [{ key: 'mtn', label: 'MTN' }, { key: 'telecel', label: 'Telecel' }],
        whatsapp: { status: 'not_connected', done: 0, steps: [{ id: 5, title: 'Meta business account', detail: 'x', status: 'todo', note: '', recorded_by: null }], price_marketing_usd: '0.0225', price_utility_usd: '0.004' },
        email: { status: 'simulated', facts: [{ label: 'Sends as', value: 'no-reply@theashantihub.com' }] }, inapp: { status: 'connected' },
      })),
      http.post(`${API}/api/marketing/sender-ids/`, async ({ request }) => { posted = await request.json(); return HttpResponse.json({ id: 1 }, { status: 201 }) }),
    )
    renderMk(SenderIdsPanel, { permissions: ['campaigns.manage'] })
    expect(await screen.findByText(/No sender ID recorded yet/)).toBeInTheDocument()
    expect(screen.getByText('Not available')).toBeInTheDocument()
    expect(screen.getAllByText('Not connected').length).toBe(2)
    fireEvent.click(screen.getByRole('button', { name: 'Record a sender ID' }))
    fireEvent.change(screen.getByLabelText('Sender ID'), { target: { value: 'AshantiHub' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(posted).toMatchObject({ name: 'AshantiHub', network: 'mtn', status: 'submitted' }))
  })
})

describe('CampaignResultsPanel', () => {
  it('says delivery and signups are not reported or tracked instead of inventing them', async () => {
    const c = campaign({ id: 7, status: 'sent', status_label: 'Sent', sent_at: '2026-10-02T11:00:00Z', provider_state: 'simulated' })
    server.use(
      http.get(`${API}/api/marketing/results/campaigns/`, () => HttpResponse.json({ results: [{ id: 7, name: 'Kente Friday', channel: 'sms', sent_at: c.sent_at, send_at: c.send_at }] })),
      http.get(`${API}/api/marketing/campaigns/7/results/`, () => HttpResponse.json({
        campaign: c, counts: { sent: 5, delivered: null, failed: 0, simulated: 5, left_out: 1, queued: 0 }, delivery_reported: false, left_out_reasons: { cap: 1 }, clicks: 2, click_rate: 40, signups: null,
        signups_note: 'Not tracked: AshantiHub does not link a new account to the message that brought it.', orders: 0, order_value: '0.00', orders_note: 'Orders by people who clicked.', cost: null, cost_estimate: '0.17',
        cost_note: 'The provider reports no cost.', cost_per_order: null, opt_outs: 0, opt_out_rate: 0, networks: [], failure_reasons: [], by_business: [], click_timing: [{ when: 'First hour', n: 1 }],
        message: 'Hello', audience_text: 'Customers (5 reached)', approval: { needed: false, text: 'No approval needed' },
      })),
    )
    renderMk(CampaignResultsPanel, { permissions: ['campaigns.manage'] })
    expect(await screen.findByText(/This send was simulated/)).toBeInTheDocument()
    expect(screen.getByText('Not reported')).toBeInTheDocument()
    expect(screen.getByText('Not tracked')).toBeInTheDocument()
    expect(screen.getByText(/No order is linked/)).toBeInTheDocument()
  })
})

describe('TrackedLinkPage', () => {
  it('only goes to a page on this site', async () => {
    expect(safePath('/events')).toBe('/events')
    for (const bad of ['//evil.test', 'https://evil.test', '/\\evil', undefined]) expect(safePath(bad)).toBe('/')
    let went = null
    server.use(http.post(`${API}/api/marketing/r/abc/`, () => HttpResponse.json({ path: '//evil.test' })))
    render(<TrackedLinkPage token="abc" onGo={(p) => { went = p }} />)
    await waitFor(() => expect(went).toBe('/'))
  })
})
