import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { server } from '../../../../mocks/server.js'
import ClientListingForm from '../ClientListingForm.jsx'

vi.mock('../../../../hooks/useDevicePosition.js', () => ({
  useDevicePosition: () => ({ position: null, error: null, locating: false, locate: vi.fn() }),
}))

const API = 'http://localhost:8000'
const TREE = [
  { id: 1, slug: 'fashion', label: 'Fashion', kind: 'product', is_accommodation: false, children: [
    { id: 2, slug: 'fabrics', label: 'Fabrics', kind: 'product', is_accommodation: false, children: [] },
  ] },
  { id: 3, slug: 'repairs', label: 'Repairs', kind: 'service', is_accommodation: false, children: [] },
  { id: 4, slug: 'guest-houses', label: 'Guest houses', kind: 'service', is_accommodation: true, children: [] },
  { id: 5, slug: 'concerts', label: 'Concerts', kind: 'event', is_accommodation: false, children: [] },
]

function serve() {
  server.use(
    http.get(`${API}/api/listings/categories/tree/`, () => HttpResponse.json(TREE)),
    http.get(`${API}/api/portfolio/meta/listing-form/`, () => HttpResponse.json({ categories: [], zones: [{ id: 3, name: 'Bantama' }], required_answers: {} })),
    http.get(`${API}/api/events/pricing-tiers/`, () => HttpResponse.json([{ id: 1, duration_days: 14, price: '50.00' }])),
  )
}
function renderForm(props = {}) {
  serve()
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <ClientListingForm businessId="12" onBack={() => {}} onSaved={() => {}} {...props} />
    </QueryClientProvider>,
  )
}
const pick = async (name) => fireEvent.click(await screen.findByRole('radio', { name }))

describe('ClientListingForm', () => {
  it('offers the four kinds', async () => {
    renderForm()
    for (const name of ['Product', 'Service', 'Event', 'Stay']) expect(await screen.findByRole('radio', { name })).toBeInTheDocument()
  })

  it('shows the event date and tickets fields for an Event', async () => {
    renderForm()
    await pick('Event')
    expect(await screen.findByLabelText('Event date and time')).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Tickets' })).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Comes with a warranty?' })).not.toBeInTheDocument()
  })

  it('shows units and the nightly price for a Stay', async () => {
    renderForm()
    await pick('Stay')
    expect(await screen.findByLabelText('Rooms or units')).toBeInTheDocument()
    expect(screen.getByLabelText('Nightly price (GH₵)')).toBeInTheDocument()
  })

  it('asks the warranty, expiry and returns questions for a Product', async () => {
    renderForm()
    await pick('Product')
    expect(await screen.findByRole('group', { name: 'Comes with a warranty?' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Can it expire?' })).toBeInTheDocument()
    expect(screen.getByLabelText('Return policy')).toBeInTheDocument()
  })

  it('lists only the categories of the chosen kind', async () => {
    renderForm()
    await pick('Service')
    const select = await screen.findByLabelText('Category')
    await waitFor(() => expect(within(select).getByRole('option', { name: 'Repairs' })).toBeInTheDocument())
    expect(within(select).queryByRole('option', { name: /Guest houses/ })).not.toBeInTheDocument()
    expect(within(select).queryByRole('option', { name: /Fabrics/ })).not.toBeInTheDocument()
  })

  it('posts the draft with its kind and shows the server message when it is refused', async () => {
    let body = null
    server.use(http.post(`${API}/api/portfolio/businesses/12/drafts/`, async ({ request }) => {
      body = await request.json()
      return HttpResponse.json({ units_total: ['Say how many rooms or units there are (at least 1).'] }, { status: 400 })
    }))
    renderForm()
    await pick('Stay')
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Kente Lodge' } })
    await waitFor(() => expect(within(screen.getByLabelText('Category')).getByRole('option', { name: /Guest houses/ })).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('Category'), { target: { value: '4' } })
    fireEvent.change(screen.getByLabelText('Area'), { target: { value: '3' } })
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Quiet rooms' } })
    fireEvent.change(screen.getByLabelText('Rooms or units'), { target: { value: '6' } })
    fireEvent.change(screen.getByLabelText('Nightly price (GH₵)'), { target: { value: '150' } })
    await waitFor(() => expect(within(screen.getByLabelText('Cancellation policy')).getByRole('option', { name: /Flexible/ })).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('Cancellation policy'), { target: { value: 'flexible' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Say how many rooms or units there are (at least 1).')
    expect(body).toMatchObject({ kind: 'stay', name: 'Kente Lodge', category: 4, units_total: 6, price_amount: '150.00', cancellation_policy: 'flexible' })
  })

  it('edits an existing draft with a PATCH that never sends the kind', async () => {
    let patched = null
    server.use(http.patch(`${API}/api/portfolio/businesses/12/drafts/9/`, async ({ request }) => {
      patched = await request.json()
      return HttpResponse.json({ id: 9 })
    }))
    const onSaved = vi.fn()
    renderForm({ onSaved, draft: { id: 9, kind: 'service', payload: { name: 'Phone repair', category: 3, zone: 3, description: 'Screens', price_amount: '40.00', service_duration: '1 hour' } } })
    const name = await screen.findByLabelText('Name')
    expect(name).toHaveValue('Phone repair')
    fireEvent.change(name, { target: { value: 'Phone screen repair' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(patched.name).toBe('Phone screen repair')
    expect(patched).not.toHaveProperty('kind')
  })
})
