import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../mocks/server.js'
import MarketingConsentCard from '../MarketingConsentCard.jsx'
import UnsubscribePage from '../UnsubscribePage.jsx'

const API = 'http://localhost:8000'
const wrap = (ui) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>)
const channels = (over = {}) => ({ channels: Object.fromEntries(['sms', 'whatsapp', 'email', 'inapp'].map((k) => [k, { label: k.toUpperCase(), status: null, at: null, wording: `Send me ${k} offers.`, ...(over[k] || {}) }])) })

describe('MarketingConsentCard', () => {
  it('shows every box unticked with its words, and saves one choice at a time', async () => {
    let sent = null
    server.use(
      http.get(`${API}/api/marketing/consent/me/`, () => HttpResponse.json(channels())),
      http.post(`${API}/api/marketing/consent/me/`, async ({ request }) => { sent = await request.json(); return HttpResponse.json(channels({ email: { status: 'opted_in' } })) }),
    )
    wrap(<MarketingConsentCard />)
    const email = await screen.findByLabelText(/EMAIL/)
    expect(email).not.toBeChecked()
    expect(screen.getByText('Send me sms offers.')).toBeInTheDocument()
    fireEvent.click(email)
    await waitFor(() => expect(sent).toEqual({ channel: 'email', opted_in: true }))
    await waitFor(() => expect(screen.getByLabelText(/EMAIL/)).toBeChecked())
    expect(screen.getByLabelText(/SMS/)).not.toBeChecked()
  })
})

describe('UnsubscribePage', () => {
  it('changes nothing on opening; the button records the stop', async () => {
    let posted = 0
    server.use(
      http.get(`${API}/api/marketing/unsubscribe/tok/`, () => HttpResponse.json({ channel: 'sms', channel_label: 'SMS', stopped: false })),
      http.post(`${API}/api/marketing/unsubscribe/tok/`, () => { posted += 1; return HttpResponse.json({ channel: 'sms', channel_label: 'SMS', stopped: true }) }),
    )
    render(<UnsubscribePage token="tok" />)
    const button = await screen.findByRole('button', { name: 'Stop SMS offers' })
    expect(posted).toBe(0)
    fireEvent.click(button)
    expect(await screen.findByText(/You will not get SMS offers/)).toBeInTheDocument()
    expect(posted).toBe(1)
  })

  it('says so for a link that is not valid', async () => {
    server.use(http.get(`${API}/api/marketing/unsubscribe/bad/`, () => HttpResponse.json({ detail: 'x' }, { status: 400 })))
    render(<UnsubscribePage token="bad" />)
    expect(await screen.findByRole('alert')).toHaveTextContent('not valid or has expired')
  })
})
