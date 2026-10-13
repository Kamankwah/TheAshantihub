import { fireEvent, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../../../../mocks/server.js'
import SegmentsPanel from '../SegmentsPanel.jsx'
import { API, renderMk } from './mkTestUtils.jsx'

const options = {
  zones: [{ id: 1, name: 'Adum' }, { id: 2, name: 'Asafo' }], categories: [{ id: 5, label: 'Kente', kind: 'product' }],
  activities: { customer: [{ key: 'any', label: 'Any customer' }, { key: 'active', label: 'Ordered or booked in the last N days' }], business_owner: [{ key: 'any', label: 'Any business' }] },
  channels: [{ key: 'sms', label: 'SMS' }, { key: 'email', label: 'Email' }], audiences: [{ key: 'customer', label: 'Customers' }, { key: 'business_owner', label: 'Businesses' }],
  zone_note: 'Zone for customers is where they have bought or booked.',
}
const preview = (count = 0) => ({ count, matched: count + 3, no_opt_in: 3, skipped_by_cap: 0, by_zone: [], channel_label: 'SMS', by_channel: { sms: count, email: 0 } })

describe('SegmentsPanel', () => {
  it('shows a live count, explains who is never counted, and saves what was drawn', async () => {
    let saved = null
    const previews = []
    server.use(
      http.get(`${API}/api/marketing/segments/options/`, () => HttpResponse.json(options)),
      http.get(`${API}/api/marketing/segments/`, () => HttpResponse.json({ results: [] })),
      http.post(`${API}/api/marketing/segments/preview/`, async ({ request }) => { const b = await request.json(); previews.push(b); return HttpResponse.json(preview(0)) }),
      http.post(`${API}/api/marketing/segments/`, async ({ request }) => { saved = await request.json(); return HttpResponse.json({ id: 1 }, { status: 201 }) }),
    )
    renderMk(SegmentsPanel, { permissions: ['campaigns.manage'] })
    expect(await screen.findByText(/No segments saved yet/)).toBeInTheDocument()
    expect(await screen.findByText(/have not opted in to SMS/)).toBeInTheDocument()
    expect(screen.getByText(/No opt-in for SMS: never counted/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Adum buyers' } })
    fireEvent.click(screen.getByLabelText('Adum'))
    fireEvent.change(screen.getByLabelText('Activity'), { target: { value: 'active' } })
    await waitFor(() => expect(previews.at(-1).filters).toMatchObject({ zones: [1], activity: 'active', days: 90 }))
    fireEvent.click(screen.getByRole('button', { name: 'Save segment' }))
    await waitFor(() => expect(saved).toEqual({ name: 'Adum buyers', audience: 'customer', channel: 'sms', filters: { zones: [1], categories: [], activity: 'active', days: 90 } }))
  })

  it('refuses to save without a name and shows the server refusal', async () => {
    server.use(
      http.get(`${API}/api/marketing/segments/options/`, () => HttpResponse.json(options)),
      http.get(`${API}/api/marketing/segments/`, () => HttpResponse.json({ results: [] })),
      http.post(`${API}/api/marketing/segments/preview/`, () => HttpResponse.json({ detail: 'Days must be between 1 and 730.' }, { status: 400 })),
    )
    renderMk(SegmentsPanel, { permissions: ['campaigns.manage'] })
    expect(await screen.findByRole('button', { name: 'Save segment' })).toBeDisabled()
    expect(await screen.findByRole('alert')).toHaveTextContent('Days must be between 1 and 730.')
  })
})
