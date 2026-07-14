import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { server } from './mocks/server.js'
import EventSubmissionPanel from './components/EventSubmissionPanel.jsx'

const CATEGORIES = [
  { id: 1, slug: 'festivals', icon: '🥁', label: 'Festivals', color: '#CC0000', kind: 'event' },
  { id: 2, slug: 'hotels', icon: '🏨', label: 'Hotels', color: '#000080', kind: 'service' },
]

const ZONES = [{ id: 1, name: 'Manhyia' }, { id: 2, name: 'Adum' }]

const USER = { fullName: 'Ama Owusu', accountType: 'customer', id: 1 };

function StubPayment({ amount, onSuccess, onClose }) {
  return (
    <div>
      <div>Pay GHS {amount}</div>
      <button onClick={() => onSuccess('REF123')}>Confirm Payment</button>
      <button onClick={onClose}>Close Payment</button>
    </div>
  )
}

function renderPanel(props = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <EventSubmissionPanel user={USER} categories={CATEGORIES} zones={ZONES} PaymentComponent={StubPayment} {...props} />
    </QueryClientProvider>,
  )
}

describe('EventSubmissionPanel', () => {
  it('prompts sign-in when there is no user', () => {
    server.use(http.get('http://localhost:8000/api/events/mine/', () => HttpResponse.json([])))
    renderPanel({ user: null })
    expect(screen.getByText(/Sign in as a customer or business owner/)).toBeInTheDocument()
  })

  it('opens the submission form only listing event-kind categories', async () => {
    server.use(http.get('http://localhost:8000/api/events/mine/', () => HttpResponse.json([])))
    renderPanel()
    fireEvent.click(screen.getByText('📅 Submit an Event'))
    expect(screen.getByText('🥁 Festivals')).toBeInTheDocument()
    expect(screen.queryByText('🏨 Hotels')).not.toBeInTheDocument()
  })

  it('submits the form and shows the pending-approval state', async () => {
    server.use(
      http.get('http://localhost:8000/api/events/mine/', () => HttpResponse.json([])),
      http.post('http://localhost:8000/api/events/submit/', async ({ request }) => {
        const body = await request.json()
        return HttpResponse.json({ id: 10, name: body.name, status: 'pending', access_level: body.access_level }, { status: 201 })
      }),
    )
    renderPanel()
    fireEvent.click(screen.getByText('📅 Submit an Event'))
    fireEvent.change(screen.getByLabelText('Event Name'), { target: { value: 'Akwasidae Festival' } })
    fireEvent.change(screen.getByLabelText('Category'), { target: { value: '1' } })
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Royal drumming.' } })
    fireEvent.change(screen.getByLabelText('Address'), { target: { value: 'Manhyia Palace' } })
    fireEvent.change(screen.getByLabelText('Event Date'), { target: { value: '2026-08-03T10:00' } })
    fireEvent.change(screen.getByLabelText('Visibility (days, 7–90)'), { target: { value: '14' } })
    fireEvent.click(screen.getByText('Submit for Review'))
    expect(await screen.findByText('✅ Submitted for review')).toBeInTheDocument()
    expect(screen.getByText(/Akwasidae Festival.*is now pending approval/)).toBeInTheDocument()
  })

  it('shows the access code for a submitted private event', async () => {
    server.use(
      http.get('http://localhost:8000/api/events/mine/', () => HttpResponse.json([])),
      http.post('http://localhost:8000/api/events/submit/', () =>
        HttpResponse.json({ id: 11, name: 'Private Party', status: 'pending', access_level: 'private', access_code: 'AB12CD' }, { status: 201 }),
      ),
    )
    renderPanel()
    fireEvent.click(screen.getByText('📅 Submit an Event'))
    fireEvent.change(screen.getByLabelText('Event Name'), { target: { value: 'Private Party' } })
    fireEvent.change(screen.getByLabelText('Category'), { target: { value: '1' } })
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Invite only.' } })
    fireEvent.change(screen.getByLabelText('Address'), { target: { value: 'Somewhere' } })
    fireEvent.change(screen.getByLabelText('Event Date'), { target: { value: '2026-08-03T10:00' } })
    fireEvent.click(screen.getByLabelText('Make this a private event (code required to view details)'))
    fireEvent.click(screen.getByText('Submit for Review'))
    expect(await screen.findByText('AB12CD')).toBeInTheDocument()
  })

  it('lists the caller\'s own events with status and a copy-able access code for private ones', async () => {
    server.use(
      http.get('http://localhost:8000/api/events/mine/', () =>
        HttpResponse.json([
          { id: 5, name: 'Kumasi Cultural Festival', status: 'pending', access_level: 'public' },
          { id: 6, name: 'Secret Launch Party', status: 'approved', access_level: 'private', access_code: 'ZZ99YY' },
        ]),
      ),
    )
    renderPanel()
    expect(await screen.findByText('Kumasi Cultural Festival')).toBeInTheDocument()
    expect(screen.getByText('Secret Launch Party')).toBeInTheDocument()
    expect(screen.getByText('ZZ99YY')).toBeInTheDocument()
  })

  it('shows a "Pay to publish" action for an approved, unpaid event and pays via PaymentComponent', async () => {
    server.use(
      http.get('http://localhost:8000/api/events/mine/', () =>
        HttpResponse.json([{ id: 7, name: 'Approved Event', status: 'approved', access_level: 'public', visibility_days: 10, paid_at: null }]),
      ),
      http.post('http://localhost:8000/api/events/7/pay/', () =>
        HttpResponse.json({ id: 7, name: 'Approved Event', status: 'approved', paid_at: '2026-07-14T00:00:00Z' }),
      ),
    )
    renderPanel()
    const payButton = await screen.findByText('💳 Pay to publish')
    fireEvent.click(payButton)
    expect(screen.getByText('Pay GHS 20')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Confirm Payment'))
    await waitFor(() => expect(screen.queryByText('Pay GHS 20')).not.toBeInTheDocument())
  })

  it('does not show "Pay to publish" once an event has already been paid for', async () => {
    server.use(
      http.get('http://localhost:8000/api/events/mine/', () =>
        HttpResponse.json([{ id: 8, name: 'Live Event', status: 'approved', access_level: 'public', visibility_days: 10, paid_at: '2026-07-01T00:00:00Z' }]),
      ),
    )
    renderPanel()
    await screen.findByText('Live Event')
    expect(screen.queryByText('💳 Pay to publish')).not.toBeInTheDocument()
  })
})
