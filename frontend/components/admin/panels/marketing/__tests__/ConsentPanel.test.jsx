import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../../../../mocks/server.js'
import ConsentPanel from '../ConsentPanel.jsx'
import { API, renderMk } from './mkTestUtils.jsx'

const summary = (over = {}) => ({
  channels: ['sms', 'whatsapp', 'email', 'inapp'].map((c) => ({ channel: c, label: c.toUpperCase(), opted_in: 0, opted_out: 0, joined_this_week: 0, left_this_week: 0 })),
  total_records: 0, first_record_at: null, opt_outs_7d: { total: 0, by_source: [] }, retention: { years: 2, records_due: 0 }, ...over,
})
const line = (over = {}) => ({ id: 1, who: 'Yaw Mensah', kind_label: 'Customer', phone: '024 *** 0011', email: 'y***@x.com', channel: 'sms', channel_label: 'SMS', status: 'opted_in', source_label: 'Checkout tickbox', source_detail: '', wording: 'sms-offers v1', at: '2026-10-12T14:02:00Z', device: 'Phone browser', recorded_by: null, ...over })
const serve = ({ s = summary(), results = [], count } = {}) => server.use(
  http.get(`${API}/api/marketing/consent/summary/`, () => HttpResponse.json(s)),
  http.get(`${API}/api/marketing/consent/ledger/`, ({ request }) => HttpResponse.json({ count: count ?? results.length, results, _q: new URL(request.url).search })),
  http.get(`${API}/api/marketing/consent/wordings/`, () => HttpResponse.json({ wordings: [{ id: 1, label: 'sms-offers v1', audience: 'customer', text: 'Send me offers from AshantiHub by SMS.', live_from: '2026-09-01T00:00:00Z', retired_at: null, records: 0 }] })),
)

describe('ConsentPanel', () => {
  it('starts honestly empty: no opt-ins, an empty ledger, no invented figures', async () => {
    serve()
    renderMk(ConsentPanel, { permissions: ['consent.view'] })
    expect(await screen.findByText(/No opt-ins recorded yet/)).toBeInTheDocument()
    expect(screen.getByText(/The ledger is empty/)).toBeInTheDocument()
    expect(screen.getAllByText('0 in')).toHaveLength(4)
    expect(screen.getByText(/nothing sent/)).toBeInTheDocument()
    expect(await screen.findByText(/Send me offers from AshantiHub by SMS/)).toBeInTheDocument()
  })

  it('shows masked contacts and reveals one only on request', async () => {
    serve({ s: summary({ total_records: 1 }), results: [line()] })
    server.use(http.post(`${API}/api/marketing/consent/ledger/1/reveal/`, () => HttpResponse.json({ phone: '+233244000011', email: 'yaw@x.com' })))
    renderMk(ConsentPanel, { permissions: ['consent.view'] })
    const row = (await screen.findByText('Yaw Mensah')).closest('tr')
    expect(within(row).getByText(/024 \*\*\* 0011/)).toBeInTheDocument()
    expect(row).not.toHaveTextContent('+233244000011')
    fireEvent.click(within(row).getByRole('button', { name: 'Show contact details of Yaw Mensah' }))
    await waitFor(() => expect(row).toHaveTextContent('+233244000011'))
  })

  it('filters the ledger through the query string', async () => {
    const seen = []
    server.use(
      http.get(`${API}/api/marketing/consent/summary/`, () => HttpResponse.json(summary())),
      http.get(`${API}/api/marketing/consent/wordings/`, () => HttpResponse.json({ wordings: [] })),
      http.get(`${API}/api/marketing/consent/ledger/`, ({ request }) => { seen.push(new URL(request.url).search); return HttpResponse.json({ count: 0, results: [] }) }),
    )
    renderMk(ConsentPanel, { permissions: ['consent.view'] })
    fireEvent.change(await screen.findByLabelText('Status'), { target: { value: 'opted_out' } })
    await waitFor(() => expect(seen).toContain('?status=opted_out'))
    fireEvent.change(screen.getByLabelText('Contact'), { target: { value: '731' } })
    await waitFor(() => expect(seen.some((q) => q.includes('contact=731') && q.includes('status=opted_out'))).toBe(true))
  })
})
