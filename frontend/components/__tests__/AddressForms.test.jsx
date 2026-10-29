import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { server } from '../../mocks/server.js'
import AddressForm from '../account/AddressForm.jsx'
import AddressPicker from '../account/AddressPicker.jsx'
import GhanaPostField from '../account/GhanaPostField.jsx'
import YourAddresses from '../account/YourAddresses.jsx'

const API = 'http://localhost:8000'
const wrap = (ui) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}
const row = (over = {}) => ({
  id: 7, label: 'Home', recipient_name: 'Akosua Mensah', phone: '0241234567', gps_address: 'AK-039-5028',
  landmark: 'Opposite Total filling station', address_text: '12 Adum Road', lat: null, lng: null,
  is_default: true, created_at: '2026-10-28T09:15:22Z', ...over,
})
const book = (rows) => server.use(http.get(`${API}/api/accounts/addresses/`, () => HttpResponse.json(rows)))
const type = (re, value) => fireEvent.change(screen.getByLabelText(re), { target: { value } })
const fillValid = () => {
  type(/recipient name/i, 'Kofi Boateng')
  type(/phone number/i, '024 123 4567')
  type(/ghana post gps address/i, 'ak0395028')
  type(/landmark/i, '  Next to the chemist ')
}

afterEach(() => vi.restoreAllMocks())

describe('GhanaPostField', () => {
  it('test_field_inserts_hyphens_while_typing', () => {
    function Host() {
      const [v, setV] = useState('')
      return <GhanaPostField value={v} onChange={setV} />
    }
    render(<Host />)
    const input = screen.getByLabelText(/ghana post gps address/i)
    fireEvent.change(input, { target: { value: 'ak039' } })
    expect(input).toHaveValue('AK-039-')
    fireEvent.change(input, { target: { value: 'AK-039-5028' } })
    expect(input).toHaveValue('AK-039-5028')
    expect(screen.getByText('Find yours in the GhanaPost GPS app')).toBeInTheDocument()
  })
})

describe('AddressForm', () => {
  it('test_form_requires_gps_and_landmark_and_shows_server_errors', async () => {
    const onSave = vi.fn()
    wrap(<AddressForm onSave={onSave} />)
    type(/recipient name/i, 'Kofi Boateng')
    type(/phone number/i, '024 123 4567')
    fireEvent.click(screen.getByRole('button', { name: /save address/i }))
    expect(await screen.findByText('A Ghana Post GPS address is required.')).toBeInTheDocument()
    expect(screen.getByText('Add a landmark near your door so the rider can find you.')).toBeInTheDocument()

    type(/ghana post gps address/i, 'GA039')
    type(/ghana post gps address/i, 'GA-039-5028')
    type(/landmark/i, 'x'.repeat(201))
    fireEvent.click(screen.getByRole('button', { name: /save address/i }))
    expect(await screen.findByText(/We deliver only in the Ashanti Region/)).toBeInTheDocument()
    expect(screen.getByText('Keep the landmark under 200 characters.')).toBeInTheDocument()

    server.use(http.post(`${API}/api/accounts/addresses/`, () =>
      HttpResponse.json({ phone: ['Enter a Ghana phone number, for example 024 123 4567.'] }, { status: 400 })))
    fillValid()
    fireEvent.click(screen.getByRole('button', { name: /save address/i }))
    expect(await screen.findByText('Enter a Ghana phone number, for example 024 123 4567.')).toBeInTheDocument()
    expect(onSave).not.toHaveBeenCalled()
  })

  it('shows the ten-address cap message', async () => {
    server.use(http.post(`${API}/api/accounts/addresses/`, () =>
      HttpResponse.json({ detail: 'You can save up to 10 addresses. Remove one to add another.' }, { status: 400 })))
    wrap(<AddressForm onSave={vi.fn()} />)
    fillValid()
    fireEvent.click(screen.getByRole('button', { name: /save address/i }))
    expect(await screen.findByText('You can save up to 10 addresses. Remove one to add another.')).toBeInTheDocument()
  })

  it('test_pin_from_the_map_fills_lat_lng_and_street_but_not_the_gps_code', async () => {
    let body
    server.use(http.post(`${API}/api/accounts/addresses/`, async ({ request }) => {
      body = await request.json()
      return HttpResponse.json(row({ id: 9 }), { status: 201 })
    }))
    wrap(<AddressForm onSave={vi.fn()} />)
    fillValid()
    fireEvent.click(screen.getByRole('button', { name: 'drop-pin' }))
    expect(screen.getByLabelText(/street or area/i)).toHaveValue('KNUST Ave, Kumasi')
    expect(screen.getByLabelText(/ghana post gps address/i)).toHaveValue('AK-039-5028')
    fireEvent.click(screen.getByRole('button', { name: /save address/i }))
    await waitFor(() => expect(body).toBeTruthy())
    expect(body.lat).toBe('6.700000')
    expect(body.lng).toBe('-1.620000')
    expect(body.address_text).toBe('KNUST Ave, Kumasi')
  })

  it('does not overwrite street text the shopper typed with the map address', () => {
    wrap(<AddressForm onSave={vi.fn()} />)
    type(/street or area/i, 'My own street')
    fireEvent.click(screen.getByRole('button', { name: 'drop-pin' }))
    expect(screen.getByLabelText(/street or area/i)).toHaveValue('My own street')
  })

  it('test_save_posts_normalised_values', async () => {
    let body
    const onSave = vi.fn()
    server.use(http.post(`${API}/api/accounts/addresses/`, async ({ request }) => {
      body = await request.json()
      return HttpResponse.json(row({ id: 9 }), { status: 201 })
    }))
    wrap(<AddressForm onSave={onSave} />)
    fillValid()
    fireEvent.click(screen.getByRole('button', { name: /save address/i }))
    await waitFor(() => expect(onSave).toHaveBeenCalled())
    expect(body).toMatchObject({
      label: 'Home', recipient_name: 'Kofi Boateng', phone: '024 123 4567', gps_address: 'AK-039-5028',
      landmark: 'Next to the chemist', address_text: '', lat: null, lng: null,
    })
    expect(body).not.toHaveProperty('is_default')
  })

  it('make-default calls set-default when the saved row is not the default', async () => {
    let called = false
    server.use(
      http.post(`${API}/api/accounts/addresses/`, () => HttpResponse.json(row({ id: 9, is_default: false }), { status: 201 })),
      http.post(`${API}/api/accounts/addresses/9/set-default/`, () => { called = true; return HttpResponse.json(row({ id: 9 })) }),
    )
    const onSave = vi.fn()
    wrap(<AddressForm onSave={onSave} />)
    fillValid()
    fireEvent.click(screen.getByLabelText(/make this my default/i))
    fireEvent.click(screen.getByRole('button', { name: /save address/i }))
    await waitFor(() => expect(onSave).toHaveBeenCalled())
    expect(called).toBe(true)
    expect(onSave.mock.calls[0][0].is_default).toBe(true)
  })
})

describe('AddressPicker', () => {
  it('test_picker_marks_default_and_selects_on_click', async () => {
    book([row(), row({ id: 8, recipient_name: 'Ama Owusu', gps_address: 'AS-123-4567', is_default: false })])
    const onChange = vi.fn()
    wrap(<AddressPicker value={7} onChange={onChange} />)
    expect(await screen.findByText('Default')).toBeInTheDocument()
    const [first, second] = screen.getAllByRole('button', { pressed: undefined }).filter((b) => b.hasAttribute('aria-pressed'))
    expect(first).toHaveAttribute('aria-pressed', 'true')
    expect(second).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(second)
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ id: 8, gps_address: 'AS-123-4567' }))
  })

  it('adds a new address inline and selects it', async () => {
    book([])
    server.use(http.post(`${API}/api/accounts/addresses/`, () => HttpResponse.json(row({ id: 12 }), { status: 201 })))
    const onChange = vi.fn()
    wrap(<AddressPicker value={null} onChange={onChange} />)
    fireEvent.click(await screen.findByRole('button', { name: /add a new address/i }))
    fillValid()
    fireEvent.click(screen.getByRole('button', { name: /save address/i }))
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ id: 12 })))
  })
})

describe('YourAddresses', () => {
  it('test_empty_state_shows_only_the_add_tile', async () => {
    book([])
    wrap(<YourAddresses />)
    expect(await screen.findByRole('button', { name: /add address/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /edit|remove|set as default/i })).toBeNull()
    expect(screen.queryByText(/default/i)).toBeNull()
  })

  it('test_set_default_and_remove_call_the_api_and_refetch', async () => {
    let rows = [row(), row({ id: 8, recipient_name: 'Ama Owusu', is_default: false })]
    let gets = 0
    const calls = []
    server.use(
      http.get(`${API}/api/accounts/addresses/`, () => { gets += 1; return HttpResponse.json(rows) }),
      http.post(`${API}/api/accounts/addresses/8/set-default/`, () => {
        calls.push('default')
        rows = [row({ id: 8, recipient_name: 'Ama Owusu' }), row({ is_default: false })]
        return HttpResponse.json(rows[0])
      }),
      http.delete(`${API}/api/accounts/addresses/7/`, () => { calls.push('delete'); rows = rows.slice(0, 1); return new HttpResponse(null, { status: 204 }) }),
    )
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    wrap(<YourAddresses />)
    expect(await screen.findByText('Akosua Mensah')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /set as default/i }))
    await waitFor(() => expect(calls).toEqual(['default']))
    await waitFor(() => expect(gets).toBe(2))
    await waitFor(() => expect(screen.getAllByRole('article')[0]).toHaveTextContent('Ama Owusu'))
    fireEvent.click(screen.getAllByRole('button', { name: /remove/i })[1])
    await waitFor(() => expect(calls).toEqual(['default', 'delete']))
    await waitFor(() => expect(gets).toBe(3))
    await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(1))
  })

  it('test_remove_needs_confirmation', async () => {
    book([row()])
    let deleted = false
    server.use(http.delete(`${API}/api/accounts/addresses/7/`, () => { deleted = true; return new HttpResponse(null, { status: 204 }) }))
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    wrap(<YourAddresses />)
    fireEvent.click(await screen.findByRole('button', { name: /remove/i }))
    expect(confirm).toHaveBeenCalled()
    await new Promise((r) => setTimeout(r, 50))
    expect(deleted).toBe(false)
  })

  it('edits a saved address in place with a PATCH', async () => {
    book([row()])
    let patched
    server.use(http.patch(`${API}/api/accounts/addresses/7/`, async ({ request }) => {
      patched = await request.json()
      return HttpResponse.json(row({ landmark: 'New landmark' }))
    }))
    wrap(<YourAddresses />)
    fireEvent.click(await screen.findByRole('button', { name: /edit/i }))
    type(/landmark/i, 'New landmark')
    fireEvent.click(screen.getByRole('button', { name: /save address/i }))
    await waitFor(() => expect(patched?.landmark).toBe('New landmark'))
    await waitFor(() => expect(screen.queryByRole('button', { name: /save address/i })).toBeNull())
  })
})
