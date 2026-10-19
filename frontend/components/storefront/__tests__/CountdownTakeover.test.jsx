import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { server } from '../../../mocks/server.js'
import { gatedOpening } from '../../../mocks/opening.js'
import CountdownTakeover from '../CountdownTakeover.jsx'
import NotifyMeForm from '../NotifyMeForm.jsx'

const NOTIFY_URL = 'http://localhost:8000/api/storefront/notify-me/'

function renderWithClient(ui) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

describe('CountdownTakeover', () => {
  it('shows_four_units with the headline formatted from opens_at', async () => {
    server.use(gatedOpening({ opensAt: '2026-11-06T06:00:00Z', serverNow: '2026-11-03T04:58:57Z' }))
    renderWithClient(<CountdownTakeover />)
    expect(await screen.findByText('The marketplace opens 6 Nov, 06:00')).toBeInTheDocument()
    for (const unit of ['Days', 'Hours', 'Minutes', 'Seconds']) {
      expect(screen.getByText(unit)).toBeInTheDocument()
    }
    // 3 days 1 hour 1 minute and 3 seconds (minus whatever ticked since the fetch).
    expect(screen.getByTestId('countdown-days')).toHaveTextContent('03')
    expect(screen.getByTestId('countdown-hours')).toHaveTextContent('01')
    expect(screen.getByTestId('countdown-minutes')).toHaveTextContent('01')
    expect(screen.getByRole('button', { name: 'Notify me' })).toBeInTheDocument()
  })

  it('hidden_when_open', async () => {
    let asked = false
    server.use(http.get('http://localhost:8000/api/storefront/opening/', () => {
      asked = true
      return HttpResponse.json({ opens_at: '2026-11-06T06:00:00Z', server_now: '2026-11-07T06:00:00Z', is_open: true, gate_enabled: true })
    }))
    const { container } = renderWithClient(<CountdownTakeover />)
    await waitFor(() => expect(asked).toBe(true))
    await new Promise((r) => setTimeout(r, 50))
    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByText('Notify me')).not.toBeInTheDocument()
  })

  it('renders nothing while the gate is switched off (default)', async () => {
    const { container } = renderWithClient(<CountdownTakeover />)
    await new Promise((r) => setTimeout(r, 50))
    expect(container).toBeEmptyDOMElement()
  })

  it('notify_button_opens_form', async () => {
    server.use(gatedOpening({ opensAt: '2026-11-06T06:00:00Z', serverNow: '2026-11-03T06:00:00Z' }))
    const onNotify = vi.fn()
    renderWithClient(<CountdownTakeover onNotify={onNotify} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Notify me' }))
    expect(onNotify).toHaveBeenCalledTimes(1)
    expect(screen.getByLabelText('Phone number')).toBeInTheDocument()
    expect(screen.getByLabelText('Email')).toBeInTheDocument()
  })
})

describe('NotifyMeForm', () => {
  it('accepts_phone_only', async () => {
    let body = null
    server.use(http.post(NOTIFY_URL, async ({ request }) => { body = await request.json(); return HttpResponse.json({ status: 'saved' }) }))
    renderWithClient(<NotifyMeForm />)
    fireEvent.change(screen.getByLabelText('Phone number'), { target: { value: '0244000001' } })
    fireEvent.click(screen.getByRole('button', { name: 'Tell me when you open' }))
    expect(await screen.findByText('We will tell you when we open.')).toBeInTheDocument()
    expect(body).toEqual({ phone: '0244000001' })
  })

  it('accepts_email_only', async () => {
    let body = null
    server.use(http.post(NOTIFY_URL, async ({ request }) => { body = await request.json(); return HttpResponse.json({ status: 'saved' }) }))
    renderWithClient(<NotifyMeForm />)
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ama@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Tell me when you open' }))
    expect(await screen.findByText('We will tell you when we open.')).toBeInTheDocument()
    expect(body).toEqual({ email: 'ama@example.com' })
  })

  it('rejects_both_empty_with_message and sends nothing', async () => {
    let posted = false
    server.use(http.post(NOTIFY_URL, () => { posted = true; return HttpResponse.json({ status: 'saved' }) }))
    renderWithClient(<NotifyMeForm />)
    fireEvent.click(screen.getByRole('button', { name: 'Tell me when you open' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a phone number or an email.')
    expect(posted).toBe(false)
  })

  it('shows the server error', async () => {
    server.use(http.post(NOTIFY_URL, () => HttpResponse.json({ detail: 'That phone number does not look right.' }, { status: 400 })))
    renderWithClient(<NotifyMeForm />)
    fireEvent.change(screen.getByLabelText('Phone number'), { target: { value: '12' } })
    fireEvent.click(screen.getByRole('button', { name: 'Tell me when you open' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('That phone number does not look right.')
  })

  it('says to wait when rate-limited', async () => {
    server.use(http.post(NOTIFY_URL, () => HttpResponse.json({ detail: 'Request was throttled.' }, { status: 429 })))
    renderWithClient(<NotifyMeForm />)
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ama@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Tell me when you open' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many tries. Please wait a minute and try again.')
  })
})
