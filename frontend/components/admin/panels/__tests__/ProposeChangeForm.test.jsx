import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { server } from '../../../../mocks/server.js'
import ProposeChangeForm from '../ProposeChangeForm.jsx'

const geo = vi.hoisted(() => ({ locate: vi.fn(), position: null, error: null, locating: false }))
vi.mock('../../../../hooks/useDevicePosition.js', () => ({
  useDevicePosition: () => ({ position: geo.position, error: geo.error, locating: geo.locating, locate: geo.locate }),
}))

const API = 'http://localhost:8000'
const business = (overrides = {}) => ({
  id: 12, business_name: 'Adwoa Fabrics', owner_name: 'Adwoa Frimpong', login_phone: '+233244000118',
  business_contact_phone: '+233244000118', email: '', gps_address: 'AK-087-2210', zone: { id: 3, name: 'Bantama' },
  opening_hours: 'Mon–Sat 08:00–18:00', business_description: 'Wax prints and kente',
  lat: '6.699700', lng: '-1.620000', location_accuracy_m: 9, location_is_manual: false, can_manage: true,
  needs_claim: true,
  ...overrides,
})

function renderForm(props = {}, b = business()) {
  const box = { live: b }
  server.use(
    http.get(`${API}/api/portfolio/businesses/12/`, () => HttpResponse.json(box.live)),
    http.get(`${API}/api/listings/zones/`, () => HttpResponse.json([{ id: 3, name: 'Bantama' }, { id: 4, name: 'Asafo' }])),
  )
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const ui = () => (
    <QueryClientProvider client={queryClient}>
      <ProposeChangeForm businessId="12" onBack={() => {}} onSent={() => {}} {...props} />
    </QueryClientProvider>
  )
  const view = render(ui())
  return {
    rerender: () => view.rerender(ui()),
    serveNext: (next) => { box.live = next; return queryClient.invalidateQueries({ queryKey: ['portfolio-business'] }) },
  }
}
function captureChanges() {
  const box = { body: null }
  server.use(http.post(`${API}/api/portfolio/businesses/12/changes/`, async ({ request }) => {
    box.body = await request.json()
    return HttpResponse.json({ approval_id: 31, approver_name: 'Ama Boateng', status: 'pending' }, { status: 201 })
  }))
  return box
}

beforeEach(() => { geo.position = null; geo.error = null; geo.locating = false; geo.locate.mockClear() })

describe('ProposeChangeForm', () => {
  it('sends only what changed, with the reason, and says who it went to', async () => {
    const sent = captureChanges()
    const onSent = vi.fn()
    renderForm({ onSent })
    expect(await screen.findByRole('button', { name: 'Send for approval' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Sign-in phone'), { target: { value: '055 400 0402' } })
    fireEvent.change(screen.getByLabelText('Days'), { target: { value: 'Mon–Sat' } })
    fireEvent.change(screen.getByLabelText('Opens'), { target: { value: '07:30' } })
    fireEvent.change(screen.getByLabelText('Closes'), { target: { value: '18:30' } })
    const send = screen.getByRole('button', { name: 'Send 2 changes for approval' })
    expect(send).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Why the change (Operations sees this)'), { target: { value: 'Moved next door and opens earlier' } })
    fireEvent.click(send)
    await waitFor(() => expect(sent.body).not.toBeNull())
    expect(sent.body).toEqual({
      fields: { login_phone: '055 400 0402', opening_hours: 'Mon–Sat 07:30–18:30' },
      reason: 'Moved next door and opens earlier',
    })
    expect(await screen.findByText('Sent to Ama Boateng')).toBeInTheDocument()
    expect(onSent).toHaveBeenCalled()
  })

  it('moves the map pin by hand and marks it so', async () => {
    const sent = captureChanges()
    renderForm()
    fireEvent.click(await screen.findByRole('button', { name: 'drop-pin' }))
    expect(screen.getByText(/Moved \d+ m\. Placed by hand/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Why the change (Operations sees this)'), { target: { value: 'Shop moved next door' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send 1 change for approval' }))
    await waitFor(() => expect(sent.body).not.toBeNull())
    expect(sent.body.fields).toEqual({ lat: 6.7, lng: -1.62, location_accuracy_m: null, location_is_manual: true })
  })

  it("uses the phone's location for the pin and refuses a fix rougher than 100 m", async () => {
    const view = renderForm()
    fireEvent.click(await screen.findByRole('button', { name: 'Use my location here' }))
    expect(geo.locate).toHaveBeenCalledTimes(1)
    geo.position = { lat: 6.71, lng: -1.61, accuracy: 140, at: new Date(Date.now() + 1000).toISOString() }
    view.rerender()
    expect(await screen.findByText('Location too rough: ±140 m')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send for approval' })).toBeDisabled()
    geo.position = { lat: 6.71, lng: -1.61, accuracy: 12, at: new Date(Date.now() + 2000).toISOString() }
    fireEvent.click(screen.getByRole('button', { name: 'Use my location here' }))
    expect(await screen.findByText(/From your location now, ±12 m\./)).toBeInTheDocument()
    expect(screen.queryByText('Location too rough: ±140 m')).not.toBeInTheDocument()
  })

  it('never offers payout details and says why', async () => {
    renderForm()
    expect(await screen.findByText("Payout details can't be changed by scouts. The owner changes them in their dashboard.")).toBeInTheDocument()
    expect(screen.queryByLabelText(/MoMo|payout|bank/i)).not.toBeInTheDocument()
  })

  it('says a super admin\'s own proposal was applied at once', async () => {
    server.use(http.post(`${API}/api/portfolio/businesses/12/changes/`, () => HttpResponse.json({ approval_id: 31, approver_name: null, status: 'approved' }, { status: 201 })))
    renderForm()
    fireEvent.change(await screen.findByLabelText('Business name'), { target: { value: 'Adwoa Textiles' } })
    fireEvent.change(screen.getByLabelText('Why the change (Operations sees this)'), { target: { value: 'New signboard' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send 1 change for approval' }))
    expect(await screen.findByText('Applied — Adwoa can undo it for 7 days.')).toBeInTheDocument()
  })

  it('says "Sent to Operations" when no approver is named', async () => {
    server.use(http.post(`${API}/api/portfolio/businesses/12/changes/`, () => HttpResponse.json({ approval_id: 31, approver_name: null, status: 'pending' }, { status: 201 })))
    renderForm()
    fireEvent.change(await screen.findByLabelText('Business name'), { target: { value: 'Adwoa Textiles' } })
    fireEvent.change(screen.getByLabelText('Why the change (Operations sees this)'), { target: { value: 'New signboard' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send 1 change for approval' }))
    expect(await screen.findByText('Sent to Operations')).toBeInTheDocument()
  })

  it('leaves sign-in details to a claimed owner and still lets the business phone change', async () => {
    renderForm({}, business({ needs_claim: false }))
    expect(await screen.findByText('The owner changes their sign-in phone and email themselves.')).toBeInTheDocument()
    expect(screen.queryByLabelText('Sign-in phone')).not.toBeInTheDocument()
    expect(screen.queryByLabelText("Owner's email")).not.toBeInTheDocument()
    expect(screen.getByLabelText('Business phone')).toBeInTheDocument()
  })

  it('keeps diffing against the business it opened with when it refetches, and says it changed', async () => {
    const sent = captureChanges()
    const view = renderForm()
    fireEvent.change(await screen.findByLabelText('Business name'), { target: { value: 'Adwoa Textiles' } })
    await view.serveNext(business({ opening_hours: 'Mon–Fri 09:00–17:00', gps_address: 'AK-999-0000' }))
    expect(await screen.findByText('This business changed while you were editing — check the details before sending.')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Why the change (Operations sees this)'), { target: { value: 'New name' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send 1 change for approval' }))
    await waitFor(() => expect(sent.body).not.toBeNull())
    expect(sent.body.fields).toEqual({ business_name: 'Adwoa Textiles' })
  })

  it('leaves the sign-in fields out when the owner claims while the form is open', async () => {
    const sent = captureChanges()
    const view = renderForm()
    fireEvent.change(await screen.findByLabelText('Sign-in phone'), { target: { value: '055 400 0402' } })
    fireEvent.change(screen.getByLabelText('Business name'), { target: { value: 'Adwoa Textiles' } })
    await view.serveNext(business({ needs_claim: false }))
    expect(await screen.findByText('The owner changes their sign-in phone and email themselves.')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Why the change (Operations sees this)'), { target: { value: 'New name' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send 1 change for approval' }))
    await waitFor(() => expect(sent.body).not.toBeNull())
    expect(sent.body.fields).toEqual({ business_name: 'Adwoa Textiles' })
  })

  it("shows the server's reason, including a field error", async () => {
    server.use(http.post(`${API}/api/portfolio/businesses/12/changes/`, () => HttpResponse.json({ login_phone: ['Already registered — ask Operations.'] }, { status: 400 })))
    renderForm()
    fireEvent.change(await screen.findByLabelText('Sign-in phone'), { target: { value: '0244000999' } })
    fireEvent.change(screen.getByLabelText('Why the change (Operations sees this)'), { target: { value: 'New phone' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send 1 change for approval' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Already registered — ask Operations.')
  })
})

describe('ProposeChangeForm — finding the phone\'s location', () => {
  it('says it is finding the location while the phone works it out', async () => {
    geo.locating = true
    renderForm()
    fireEvent.click(await screen.findByRole('button', { name: 'Use my location here' }))
    expect(geo.locate).toHaveBeenCalled()
    expect(screen.getByText('Finding your location…')).toBeInTheDocument()
  })

  it("says why the phone couldn't give a location, and that the pin can go in by hand", async () => {
    geo.error = 'Location is blocked for AshantiHub on this phone.'
    renderForm()
    expect(await screen.findByRole('alert')).toHaveTextContent('Location is blocked for AshantiHub on this phone.')
    expect(screen.getByRole('alert')).toHaveTextContent('You can also place the pin by hand on the map below')
    expect(screen.queryByText('Finding your location…')).not.toBeInTheDocument()
  })

  it('names the lead, masks the phone and treats an untouched phone box as no change', async () => {
    const box = captureChanges()
    renderForm({ leadName: 'Ama Boateng' })
    expect((await screen.findAllByText(/before Ama sees it/)).length).toBeGreaterThan(0)
    expect(screen.getAllByText('Now: 024 *** 118').length).toBeGreaterThan(0)
    expect(screen.queryByText(/\+233244000118/)).not.toBeInTheDocument()
    expect(screen.getByText(/Goes to Ama Boateng for approval\. The owner is told and can undo it for 7 days\./)).toBeInTheDocument()
    expect(screen.getByLabelText(/Why the change \(Ama sees this\)/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Business name'), { target: { value: 'Adwoa Fabrics & Beads' } })
    fireEvent.change(screen.getByLabelText(/Why the change/), { target: { value: 'New name' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send 1 change to Ama Boateng' }))
    await waitFor(() => expect(box.body).not.toBeNull())
    expect(box.body.fields).toEqual({ business_name: 'Adwoa Fabrics & Beads' })
  })
})
