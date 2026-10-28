import { useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../../../mocks/server.js'
import SupportCannedPanel from '../SupportCannedPanel.jsx'
import SupportTagsPanel from '../SupportTagsPanel.jsx'
import SupportPeoplePanel from '../SupportPeoplePanel.jsx'

const API = 'http://localhost:8000'
const wrap = (ui) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>)

describe('SupportCannedPanel', () => {
  it('previews with unresolved fields kept highlighted, and retires a reply', async () => {
    const seen = []
    server.use(
      http.get(`${API}/api/messaging/staff/canned/fields/`, () => HttpResponse.json([{ name: 'eta', code: '{eta}', hint: 'Expected time' }])),
      http.get(`${API}/api/messaging/staff/canned/`, () => HttpResponse.json([{ id: 3, title: 'Rider running late', shortcut: '/late', body: 'Hi {customer_first_name}, by {eta}.', audience: 'customer', uses: 14, updated_at: '2026-10-02T10:00:00Z', updated_by_name: 'Nana Yaa Ofori', retired_at: null }])),
      http.get(`${API}/api/messaging/staff/`, () => HttpResponse.json({ results: [] })),
      http.post(`${API}/api/messaging/staff/canned/preview/`, () => HttpResponse.json({ text: 'Hi Yaw, by {eta}.', unresolved: ['eta'] })),
      http.post(`${API}/api/messaging/staff/canned/3/retire/`, () => { seen.push('retire'); return HttpResponse.json({ id: 3 }) }),
    )
    wrap(<SupportCannedPanel />)
    expect(await screen.findByText('Library · 1')).toBeInTheDocument()
    expect(await screen.findByText(/14 uses/)).toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: 'Preview' }))
    expect(await screen.findByText(/stays highlighted for the agent to type before sending. Nothing is guessed/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retire' }))
    await waitFor(() => expect(seen).toEqual(['retire']))
  })
})

describe('SupportTagsPanel', () => {
  it('shows server counts, adds a tag and merges two', async () => {
    const seen = []
    const tags = [{ id: 1, name: 'late-rider', description: 'Rider late', open_now: 2, last_30_days: 31 }, { id: 2, name: 'late', description: 'Mistake', open_now: 0, last_30_days: 3 }]
    server.use(
      http.get(`${API}/api/messaging/staff/tags/`, ({ request }) => HttpResponse.json(new URL(request.url).searchParams.get('archived') ? [] : tags)),
      http.post(`${API}/api/messaging/staff/tags/`, async ({ request }) => { seen.push(['add', await request.json()]); return HttpResponse.json({ id: 3 }, { status: 201 }) }),
      http.post(`${API}/api/messaging/staff/tags/2/merge/`, async ({ request }) => { seen.push(['merge', await request.json()]); return HttpResponse.json({ moved: 3, into: tags[0] }) }),
    )
    wrap(<SupportTagsPanel />)
    expect(await screen.findByText('In use · 2')).toBeInTheDocument()
    expect(screen.getByText('31')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'pickup-delay' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add tag' }))
    await waitFor(() => expect(seen[0]).toEqual(['add', { name: 'pickup-delay', description: '' }]))
    fireEvent.change(screen.getByLabelText('Merge', { selector: 'select' }), { target: { value: '2' } })
    fireEvent.change(screen.getByLabelText('Into', { selector: 'select' }), { target: { value: '1' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Merge' }).at(-1))
    await waitFor(() => expect(seen.at(-1)).toEqual(['merge', { into: 1 }]))
    expect(await screen.findByText(/3 conversations moved/)).toBeInTheDocument()
  })
})

describe('SupportPeoplePanel', () => {
  it('searches, then opens a customer profile with masked data and records the open', async () => {
    const seen = []
    const person = { kind: 'customer', id: 3, name: 'Yaw Mensah', type: 'Customer', area: null, phone: '024 *** 553', activity: '3 orders', open_conversations: 1, status: { key: 'active', label: 'Active' } }
    server.use(
      http.get(`${API}/api/support/staff/people/recent/`, () => HttpResponse.json([])),
      http.get(`${API}/api/support/staff/people/`, () => HttpResponse.json([person])),
      http.get(`${API}/api/support/staff/customers/3/360/`, () => HttpResponse.json({
        kind: 'customer', profile: { id: 3, name: 'Yaw Mensah', phone: '024 *** 553', email: 'y•••@gmail.com', since: '2026-09-01T00:00:00Z', status: { key: 'active', label: 'Active' } },
        kpis: { orders: 3, door_to_door: 2, pickup: 1, order_value: '900.00', conversations: 1, open_conversations: 1, calls: 0, last_call_at: null, disputes: 0, reviews: 0, pending_reviews: 0 },
        orders: [], conversations: [], calls: [], disputes: [], reviews: [],
      })),
      http.post(`${API}/api/support/staff/profile-opened/`, async ({ request }) => { seen.push(await request.json()); return HttpResponse.json({ recorded: true }) }),
    )
    const Host = () => { const [p, setP] = useState(null); return <SupportPeoplePanel profile={p} onOpenProfile={(kind, id) => setP({ kind, id })} onBack={() => setP(null)} /> }
    wrap(<Host />)
    expect(await screen.findByText('Nobody has been in touch recently.')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/Name, phone, order number/), { target: { value: 'yaw' } })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Yaw Mensah' }))
    expect(await screen.findByRole('heading', { name: 'Yaw Mensah' })).toBeInTheDocument()
    expect(screen.getByText(/y•••@gmail.com/)).toBeInTheDocument()
    expect(screen.getByText(/never shown here/)).toBeInTheDocument()
    await waitFor(() => expect(seen).toEqual([{ kind: 'customer', id: 3 }]))
  })
})

describe('SupportPeoplePanel opening hours', () => {
  // Director ruling 7 (2026-10-20): Support may set a business's opening hours (businesses.set_hours), on the profile.
  const business = (hours) => http.get(`${API}/api/support/staff/businesses/5/360/`, () => HttpResponse.json({
    kind: 'business', profile: { id: 5, name: 'Akosua Ntoma', owner_name: 'Akosua', phone: '024 *** 118', since: '2026-09-01T00:00:00Z', status: { key: 'verified', label: 'Verified' }, account_manager: null },
    kpis: { listings_live: 2, listings_total: 3, conversations: 0, open_conversations: 0, calls: 0, last_call_at: null, reviews: 0 },
    subscription: null, conversations: [], calls: [], hours,
  }))
  const opened = [http.post(`${API}/api/support/staff/profile-opened/`, () => HttpResponse.json({ recorded: true })), http.get(`${API}/api/support/staff/people/recent/`, () => HttpResponse.json([]))]

  it('shows the hours and lets a holder of businesses.set_hours enter them', async () => {
    let sent = null
    server.use(business([]), ...opened, http.put(`${API}/api/portfolio/businesses/5/hours/`, async ({ request }) => {
      sent = await request.json()
      return HttpResponse.json({ days: sent.days, has_hours: true })
    }))
    wrap(<SupportPeoplePanel profile={{ kind: 'business', id: 5 }} auth={{ hasPermission: (c) => c === 'businesses.set_hours' }} />)
    expect(await screen.findByRole('region', { name: 'Opening hours' })).toBeInTheDocument()
    expect(screen.getByText('Read-only except opening hours')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Enter opening hours' }))
    for (const day of ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']) {
      fireEvent.change(screen.getByLabelText(`${day} opens`), { target: { value: '08:00' } })
      fireEvent.change(screen.getByLabelText(`${day} closes`), { target: { value: '18:00' } })
    }
    fireEvent.click(screen.getByRole('button', { name: 'Save opening hours' }))
    await waitFor(() => expect(sent?.days).toHaveLength(7))
  })

  it('shows the hours read-only without the permission', async () => {
    server.use(business([]), ...opened)
    wrap(<SupportPeoplePanel profile={{ kind: 'business', id: 5 }} auth={{ hasPermission: () => false }} />)
    expect(await screen.findByRole('region', { name: 'Opening hours' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /opening hours/ })).not.toBeInTheDocument()
    expect(screen.getByText('Read-only')).toBeInTheDocument()
  })
})
