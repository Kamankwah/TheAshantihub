import { fireEvent, screen, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { server } from '../../../../../mocks/server.js'
import MarketingOverviewPanel, { kpiList } from '../MarketingOverviewPanel.jsx'
import { API, renderMk } from './mkTestUtils.jsx'

const section = (note) => ({ state: 'not_tracked', note })
const overview = (over = {}) => ({
  now: '2026-10-13T11:46:00', days: 7,
  channels: [
    { key: 'sms', name: 'SMS', status: 'not_connected', provider: 'None', summary: 'AshantiHub sends no text messages.' },
    { key: 'whatsapp', name: 'WhatsApp', status: 'not_connected', provider: 'None (link only)', summary: '' },
    { key: 'email', name: 'Email', status: 'connected', provider: 'Mail server (SMTP)', summary: '' },
    { key: 'inapp', name: 'In-app', status: 'connected', provider: 'AshantiHub', summary: '' },
  ],
  messages: { state: 'not_tracked', note: 'No campaigns have been sent yet.', by_channel: [] },
  opt_ins: section('No opt-ins recorded yet. Opt-in appears on sign-up and Settings.'),
  orders: section('Not tracked: no campaign link has been clicked yet.'),
  coupons: section('No coupons yet.'), banners: section('No banners yet.'),
  promotions: { amount: '0.00', count: 0, businesses: 0 }, scheduled_next: [],
  queues: [
    { key: 'hero', title: 'Hero approval', count: 2, oldest: new Date(Date.now() - 4 * 3600e3).toISOString() },
    { key: 'events-moderation', title: 'Events', count: 0, oldest: null },
    { key: 'promotions', title: 'Promotions', count: 3, oldest: new Date(Date.now() - 3600e3).toISOString() },
  ],
  waiting_on_others: [{ id: 9, title: 'Change the marketing send window and limits', created_at: new Date(Date.now() - 2 * 3600e3).toISOString(), kind: 'marketing.send_policy', waiting_on: 'Super Admin' }],
  policy: { window_start: '08:00', window_end: '19:00', send_days: [0, 1, 2, 3, 4, 5], per_person_cap_days: 3 }, threshold: '25.00', simulated_payments: true,
  ...over,
})
const serve = (data = overview()) => server.use(http.get(`${API}/api/marketing/overview/`, () => HttpResponse.json(data)))

describe('MarketingOverviewPanel', () => {
  it('shows only real things before anything has been sent: no invented figures', async () => {
    serve()
    renderMk(MarketingOverviewPanel, { permissions: ['campaigns.manage'] })
    expect(screen.getByRole('heading', { name: 'Marketing overview' })).toBeInTheDocument()
    const delivered = await screen.findByRole('group', { name: 'Messages delivered' })
    expect(delivered).toHaveTextContent('—')
    expect(delivered).toHaveTextContent('No campaigns have been sent yet.')
    expect(screen.getByRole('group', { name: 'Net new opt-ins' })).toHaveTextContent('No opt-ins recorded yet')
    expect(screen.getByRole('group', { name: 'Promotion revenue' })).toHaveTextContent('GH₵ 0.00')
    const channels = screen.getByRole('list', { name: 'Channel status' })
    expect(within(channels).getAllByText(/^Not connected/)).toHaveLength(2)
    expect(within(channels).getAllByText(/^Connected/)).toHaveLength(2)
    expect(screen.getByText(/nothing is sent on those channels/)).toBeInTheDocument()
    expect(screen.getByText(/Nothing is scheduled/)).toBeInTheDocument()
    expect(screen.getByText(/Window 08:00–19:00, Monday to Saturday — nothing sends on Sundays/)).toBeInTheDocument()
    expect(screen.getByText(/Spend above GH₵ 25.00 waits for Super Admin/)).toBeInTheDocument()
  })

  it('lists the queues and my requests with Super Admin, and opens a queue', async () => {
    serve()
    const onNavigate = vi.fn()
    renderMk(MarketingOverviewPanel, { permissions: ['campaigns.manage'], props: { onNavigate } })
    const hero = await screen.findByRole('button', { name: /Hero approval/ })
    expect(hero).toHaveTextContent('2')
    expect(hero).toHaveTextContent('Oldest 4 h')
    fireEvent.click(hero)
    expect(onNavigate).toHaveBeenCalledWith('hero')
    expect(screen.getByRole('button', { name: /Events/ })).toHaveTextContent('Nothing waiting')
    expect(screen.getByText(/With Super Admin since/)).toBeInTheDocument()
  })

  it('switches the period and only offers New campaign to someone who can compose', async () => {
    const seen = []
    server.use(http.get(`${API}/api/marketing/overview/`, ({ request }) => { seen.push(new URL(request.url).searchParams.get('days')); return HttpResponse.json(overview()) }))
    renderMk(MarketingOverviewPanel, { permissions: [] })
    await screen.findByRole('group', { name: 'Messages delivered' })
    expect(screen.queryByRole('button', { name: 'New campaign' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '30 days' }))
    await screen.findByRole('button', { name: '30 days', pressed: true })
    expect(seen).toEqual(['7', '30'])
  })

  it('draws real figures when the packages that own them report some', () => {
    const cards = kpiList(overview({
      messages: { state: 'ok', delivered: 813, sent: 840, failed: 27 },
      opt_ins: { state: 'ok', joined: 100, left: 14, net: 86 }, orders: { state: 'ok', orders: 37, value: '4190.00' },
      coupons: { state: 'ok', redemptions: 52, cost: '780.00' }, banners: { state: 'ok', ctr: 2.4, clicks: 286, views: 11900 },
      promotions: { amount: '1350.00', count: 9, businesses: 9 },
    }))
    const by = Object.fromEntries(cards.map((c) => [c.key, c]))
    expect(by.delivered.value).toBe('813')
    expect(by.optins.value).toBe('+86')
    expect(by.orders.sub).toMatch(/GH₵ 4,190.00 order value/)
    expect(by.coupons.sub).toMatch(/Discount cost GH₵ 780.00/)
    expect(by.banners.value).toBe('2.4%')
    expect(by.promotions.sub).toMatch(/paid by 9 businesses/)
  })
})
