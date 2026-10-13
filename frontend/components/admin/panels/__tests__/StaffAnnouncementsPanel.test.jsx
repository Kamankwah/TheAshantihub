import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../../../mocks/server.js'
import AnnouncementBanner from '../../shell/AnnouncementBanner.jsx'
import StaffAnnouncementsPanel from '../StaffAnnouncementsPanel.jsx'

const API = 'http://localhost:8000'
const sent = (over = {}) => ({ id: 7, title: 'Pickup codes', body: 'Type the code.', status: 'sent', to: 'Scout', roles: ['scout'], team_manager: null, require_confirm: true, send_email: false, send_at: null, sent_at: '2026-10-12T09:00:00Z', created_at: '2026-10-12T09:00:00Z', created_by: 'Simon', recipients: 17, emailed: 0, opened: 12, confirmed: 9, not_opened: 5, last_reminded_at: null, ...over })
const payload = (over = {}) => ({
  announcements: [sent()], roles: [{ name: 'scout', label: 'Scout', people: 12 }, { name: 'support', label: 'Support', people: 5 }],
  teams: [{ id: 3, name: 'Ama Boateng', people: 4 }], channels: { in_app: true, email: false, push: false, sms: false, whatsapp: false }, ...over,
})
const wrap = (ui) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>)

describe('StaffAnnouncementsPanel', () => {
  it('shows read counts, never claims connected channels, and says it is staff only', async () => {
    server.use(http.get(`${API}/api/announcements/`, () => HttpResponse.json(payload())))
    wrap(<StaffAnnouncementsPanel />)
    const row = (await screen.findByText('Pickup codes', { selector: 'span' })).closest('tr')
    expect(row).toHaveTextContent('17 people')
    expect(row).toHaveTextContent('12')
    expect(row).toHaveTextContent('9')
    expect(screen.getByText(/never reach customers or businesses/)).toBeInTheDocument()
    expect(screen.getByText(/Email — not connected on this server/)).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /SMS — not connected/ })).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: /Push to phones — not connected/ })).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: /WhatsApp — not connected/ })).toBeDisabled()
  })

  it('sends an announcement to the chosen roles', async () => {
    let posted = null
    server.use(
      http.get(`${API}/api/announcements/`, () => HttpResponse.json(payload())),
      http.post(`${API}/api/announcements/`, async ({ request }) => { posted = await request.json(); return HttpResponse.json(sent(), { status: 201 }) }),
    )
    wrap(<StaffAnnouncementsPanel />)
    fireEvent.change(await screen.findByLabelText('Title'), { target: { value: 'Hello' } })
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Body text' } })
    fireEvent.click(screen.getByRole('checkbox', { name: /Scout/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /Ask each person/ }))
    expect(screen.getByRole('note', { name: 'What staff will see' })).toHaveTextContent('Hello')
    fireEvent.click(screen.getByRole('button', { name: 'Send now' }))
    await waitFor(() => expect(posted).toMatchObject({ title: 'Hello', body: 'Body text', roles: ['scout'], require_confirm: true, send_email: false, when: 'now' }))
    expect(await screen.findByText('Sent.')).toBeInTheDocument()
  })

  it('reminds those who have not confirmed and shows the server reason when refused', async () => {
    let calls = 0
    server.use(
      http.get(`${API}/api/announcements/`, () => HttpResponse.json(payload())),
      http.post(`${API}/api/announcements/7/remind/`, () => {
        calls += 1
        return calls === 1 ? HttpResponse.json({ reminded: 8 }) : HttpResponse.json({ detail: 'You already sent a reminder in the last hour.' }, { status: 400 })
      }),
    )
    wrap(<StaffAnnouncementsPanel />)
    fireEvent.click(await screen.findByRole('button', { name: 'Remind them about Pickup codes' }))
    expect(await screen.findByText('Reminded 8 people.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Remind them about Pickup codes' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('already sent a reminder')
  })
})

describe('AnnouncementBanner', () => {
  const item = (over = {}) => ({ id: 7, title: 'Pickup codes', body: 'Type the code.', sent_at: '2026-10-12T09:00:00Z', from: 'Simon', require_confirm: true, ...over })

  it('stays until a notice that asks is confirmed', async () => {
    let confirmed = 0
    let waiting = [item()]
    server.use(
      http.get(`${API}/api/announcements/mine/`, () => HttpResponse.json(waiting)),
      http.post(`${API}/api/announcements/mine/7/confirm/`, () => { confirmed += 1; waiting = []; return new HttpResponse(null, { status: 204 }) }),
    )
    wrap(<AnnouncementBanner />)
    expect(await screen.findByText('Pickup codes')).toBeInTheDocument()
    expect(screen.getByText(/From Simon/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'I’ve read this' }))
    await waitFor(() => expect(screen.queryByText('Pickup codes')).not.toBeInTheDocument())
    expect(confirmed).toBe(1)
  })

  it('is dismissed with open when it asks for nothing, and renders nothing when empty', async () => {
    let opened = 0
    let waiting = [item({ require_confirm: false })]
    server.use(
      http.get(`${API}/api/announcements/mine/`, () => HttpResponse.json(waiting)),
      http.post(`${API}/api/announcements/mine/7/open/`, () => { opened += 1; waiting = []; return new HttpResponse(null, { status: 204 }) }),
    )
    const { container } = wrap(<AnnouncementBanner />)
    fireEvent.click(await screen.findByRole('button', { name: 'Dismiss' }))
    await waitFor(() => expect(container).toBeEmptyDOMElement())
    expect(opened).toBe(1)
  })
})
