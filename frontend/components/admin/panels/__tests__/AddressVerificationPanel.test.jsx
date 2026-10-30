import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { server } from '../../../../mocks/server.js'
import AddressVerificationPanel from '../AddressVerificationPanel.jsx'

const API = 'http://localhost:8000'
const QUEUE = `${API}/api/accounts/address-verification/`
const URL_OF_LINK = 'https://app.test/share-location#token=abc123secret'

const row = (overrides = {}) => ({
  id: 7, business_name: "Akosua's Chop Bar", owner_name: 'Akosua Ntoma', phone: '+233•••••4321', zone: 'Asafo', kyc_status: 'pending',
  gps_address: 'AK-039-5128', signboard_photo: `${API}/media/signboards/akosua.jpg`,
  pin: { lat: 6.69, lng: -1.62, accuracy_m: 12, set_by: 'owner', set_by_staff_name: null, set_at: '2026-10-30T08:00:00Z', is_manual: false },
  registrar: { id: 3, name: 'Kwame Asante' },
  last_capture: { source: 'link', created_at: '2026-10-30T07:00:00Z', expires_at: '2026-11-01T07:00:00Z', used_at: '2026-10-30T08:00:00Z', revoked_at: null, state: 'used', accuracy_m: 12, sent_by_name: 'Ama Boateng' },
  address_status: 'not_verified', verification: null,
  evidence: { owner_gps_50m: true, signboard: true, scout_report: false, first_verification: true },
  can_decide: true, blocked_reason: null,
  ...overrides,
})
const page = (results) => ({ count: results.length, next: null, previous: null, results })

function mockQueue(byStatus) {
  const asked = []
  server.use(http.get(QUEUE, ({ request }) => {
    const status = new URL(request.url).searchParams.get('status') || 'pending'
    asked.push(status)
    return HttpResponse.json(page(byStatus[status] || []))
  }))
  return asked
}
function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const view = render(<QueryClientProvider client={queryClient}><AddressVerificationPanel /></QueryClientProvider>)
  return { ...view, queryClient }
}
async function openRow(name = "Akosua's Chop Bar") {
  const group = await screen.findByRole('group', { name })
  fireEvent.click(within(group).getByRole('button', { name: /view details/i }))
  return group
}

describe('AddressVerificationPanel: the queue', () => {
  it('lists pending businesses with owner, zone, code, pin state and last link state', async () => {
    mockQueue({ pending: [row(), row({ id: 8, business_name: 'Kofi Tailoring', owner_name: 'Kofi Mensah', zone: 'Adum', gps_address: null, pin: null, last_capture: null, evidence: { owner_gps_50m: false, signboard: false, scout_report: false, first_verification: true } })] })
    renderPanel()
    const first = await screen.findByRole('group', { name: "Akosua's Chop Bar" })
    expect(within(first).getByText(/Akosua Ntoma · Asafo · AK-039-5128/)).toBeInTheDocument()
    expect(within(first).getByText('Pin ±12 m, set by the owner')).toBeInTheDocument()
    expect(within(first).getByText(/Link by Ama Boateng sent .*, used/)).toBeInTheDocument()
    const second = screen.getByRole('group', { name: 'Kofi Tailoring' })
    expect(within(second).getByText('Kofi Mensah · Adum')).toBeInTheDocument()
    expect(within(second).getByText('No pin yet')).toBeInTheDocument()
    expect(within(second).getByText('No link sent')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Pending · 2/ })).toHaveAttribute('aria-pressed', 'true')
  })

  it('names who set the pin when a staff member did', async () => {
    mockQueue({ pending: [row({ pin: { lat: 6.69, lng: -1.62, accuracy_m: 80, set_by: 'scout', set_by_staff_name: 'Efua Mensah', set_at: null, is_manual: true } })] })
    renderPanel()
    expect(await screen.findByText('Pin ±80 m, set by a scout (Efua Mensah), placed by hand')).toBeInTheDocument()
  })

  it('asks for the verified and wrong tabs by status', async () => {
    const asked = mockQueue({ pending: [], verified: [row({ id: 9, business_name: 'Done Shop' })], wrong: [] })
    renderPanel()
    expect(await screen.findByText('No addresses are waiting to be verified.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Verified' }))
    expect(await screen.findByRole('group', { name: 'Done Shop' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Marked wrong' }))
    expect(await screen.findByText('No addresses have been marked wrong.')).toBeInTheDocument()
    expect(asked).toEqual(expect.arrayContaining(['pending', 'verified', 'wrong']))
  })
})

describe('AddressVerificationPanel: the detail', () => {
  it('shows the stored pin on a map with its radius, the photo, code, registrar, link and evidence', async () => {
    mockQueue({ pending: [row()] })
    renderPanel()
    const group = await openRow()
    const map = within(group).getByTestId('address-pin-map')
    expect(map).toHaveAttribute('data-lat', '6.69')
    expect(map).toHaveAttribute('data-lng', '-1.62')
    expect(map).toHaveAttribute('data-radius', '12')
    expect(within(group).getByRole('img', { name: "Signboard of Akosua's Chop Bar" })).toBeInTheDocument()
    expect(within(group).getByText('AK-039-5128', { selector: 'div' })).toBeInTheDocument()
    expect(within(group).getByText('Kwame Asante')).toBeInTheDocument()
    expect(within(group).getByText(/Owner's own GPS fix from the shop, within 50 m/).textContent).toMatch(/yes/)
    expect(within(group).getByText(/Scout's report confirming the address/).textContent).toMatch(/no/)
    expect(within(group).getByText(/First verification: needs a video call/)).toBeInTheDocument()
  })

  it('shows no map and says so when there is no pin, and says when there is no photo or code', async () => {
    mockQueue({ pending: [row({ pin: null, signboard_photo: null, gps_address: null, registrar: null, evidence: { owner_gps_50m: false, signboard: false, scout_report: false, first_verification: true } })] })
    renderPanel()
    const group = await openRow()
    expect(within(group).queryByTestId('address-pin-map')).not.toBeInTheDocument()
    expect(within(group).getByText(/^No pin yet\. There is nothing to show on a map/)).toBeInTheDocument()
    expect(within(group).getByText('No signboard photo')).toBeInTheDocument()
    expect(within(group).getByText('Not stored')).toBeInTheDocument()
    expect(within(group).getByText('No staff registrar on record')).toBeInTheDocument()
    expect(within(group).queryByText(/Registered online/)).not.toBeInTheDocument()
  })
})

describe('AddressVerificationPanel: send location link', () => {
  it('shows the returned URL with Copy, the expiry and the simulated-text wording', async () => {
    mockQueue({ pending: [row()] })
    let sentBody
    server.use(http.post(`${API}/api/accounts/location-links/`, async ({ request }) => {
      sentBody = await request.json()
      return HttpResponse.json({ id: 5, url: URL_OF_LINK, expires_at: '2026-11-01T09:00:00Z', sms_state: 'simulated', phone_masked: '+233•••••4321' }, { status: 201 })
    }))
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    renderPanel()
    const group = await openRow()
    expect(within(group).queryByLabelText('Location link')).not.toBeInTheDocument()
    fireEvent.click(within(group).getByRole('button', { name: 'Send location link' }))
    const input = await within(group).findByLabelText('Location link')
    expect(sentBody).toEqual({ business_owner: 7 })
    expect(input).toHaveValue(URL_OF_LINK)
    expect(within(group).getByText(/^Works once\. Expires .+\.$/)).toBeInTheDocument()
    expect(within(group).getByText("Texts are simulated on this server — copy the link and send it from AshantiHub's support line.")).toBeInTheDocument()
    fireEvent.click(within(group).getByRole('button', { name: 'Copy link' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(URL_OF_LINK))
    expect(await within(group).findByText('Copied.')).toBeInTheDocument()
    // The URL is never persisted, and closing the row drops it.
    expect(JSON.stringify({ ...localStorage, ...sessionStorage })).not.toContain('abc123secret')
    fireEvent.click(within(group).getByRole('button', { name: /hide details/i }))
    fireEvent.click(within(group).getByRole('button', { name: /view details/i }))
    expect(within(group).queryByLabelText('Location link')).not.toBeInTheDocument()
  })

  it('says the text went out when sms_state is sent, and gives the fallback wording for failed and no_phone', async () => {
    mockQueue({ pending: [row()] })
    let state = 'sent'
    server.use(http.post(`${API}/api/accounts/location-links/`, () => HttpResponse.json({ id: 5, url: URL_OF_LINK, expires_at: '2026-11-01T09:00:00Z', sms_state: state, phone_masked: '+233•••••4321' }, { status: 201 })))
    renderPanel()
    const group = await openRow()
    fireEvent.click(within(group).getByRole('button', { name: 'Send location link' }))
    expect(await within(group).findByText('Text sent to +233•••••4321.')).toBeInTheDocument()
    state = 'failed'
    fireEvent.click(within(group).getByRole('button', { name: 'Send location link' }))
    expect(await within(group).findByText(/The text could not be sent\. Copy the link/)).toBeInTheDocument()
    state = 'no_phone'
    fireEvent.click(within(group).getByRole('button', { name: 'Send location link' }))
    expect(await within(group).findByText(/There is no phone number on file to text/)).toBeInTheDocument()
  })

  it('shows the server message for a rejected KYC (409) and for too many links (429), with no URL', async () => {
    mockQueue({ pending: [row()] })
    let next = { status: 429, body: { detail: 'Five location links a day is the most one business can be sent. Try again tomorrow.', code: 'too_many_links' } }
    server.use(http.post(`${API}/api/accounts/location-links/`, () => HttpResponse.json(next.body, { status: next.status })))
    renderPanel()
    const group = await openRow()
    fireEvent.click(within(group).getByRole('button', { name: 'Send location link' }))
    expect(await within(group).findByRole('alert')).toHaveTextContent('Five location links a day')
    next = { status: 409, body: { detail: "This business's KYC was rejected.", code: 'kyc_rejected' } }
    fireEvent.click(within(group).getByRole('button', { name: 'Send location link' }))
    await waitFor(() => expect(within(group).getByRole('alert')).toHaveTextContent('KYC was rejected'))
    expect(within(group).queryByLabelText('Location link')).not.toBeInTheDocument()
  })
})

describe('AddressVerificationPanel: mark verified', () => {
  it('needs a note for a video call: nothing is sent without it, and the body is exact with it', async () => {
    const queue = mockQueue({ pending: [row()] })
    const bodies = []
    server.use(http.post(`${QUEUE}7/decide/`, async ({ request }) => { bodies.push(await request.json()); return HttpResponse.json(row({ address_status: 'verified' })) }))
    renderPanel()
    const group = await openRow()
    fireEvent.click(within(group).getByRole('button', { name: 'Mark verified' }))
    expect(within(group).getByLabelText('Method')).toHaveValue('video_call')
    fireEvent.click(within(group).getByRole('button', { name: 'Confirm verified' }))
    expect(await within(group).findByRole('alert')).toHaveTextContent('Write what the video call showed.')
    expect(bodies).toEqual([])
    fireEvent.change(within(group).getByLabelText(/What the video call showed/), { target: { value: '  Showed the signboard and the gate.  ' } })
    fireEvent.click(within(group).getByRole('button', { name: 'Confirm verified' }))
    await waitFor(() => expect(bodies).toEqual([{ result: 'verified', method: 'video_call', note: 'Showed the signboard and the gate.', pin_set_at: '2026-10-30T08:00:00Z' }]))
    expect(await screen.findByRole('status')).toHaveTextContent("Akosua's Chop Bar: address marked verified.")
    await waitFor(() => expect(queue.length).toBeGreaterThan(1)) // the list was fetched again
  })

  it('does not need a note for a scout report, and shows the server refusal verbatim', async () => {
    mockQueue({ pending: [row()] })
    const bodies = []
    server.use(http.post(`${QUEUE}7/decide/`, async ({ request }) => {
      bodies.push(await request.json())
      return HttpResponse.json({ detail: 'No scout has reported visiting this shop and confirming its address.', code: 'scout_report_missing' }, { status: 400 })
    }))
    renderPanel()
    const group = await openRow()
    fireEvent.click(within(group).getByRole('button', { name: 'Mark verified' }))
    fireEvent.change(within(group).getByLabelText('Method'), { target: { value: 'scout' } })
    fireEvent.click(within(group).getByRole('button', { name: 'Confirm verified' }))
    expect(await within(group).findByRole('alert')).toHaveTextContent('No scout has reported visiting this shop and confirming its address.')
    expect(bodies).toEqual([{ result: 'verified', method: 'scout', note: '', pin_set_at: '2026-10-30T08:00:00Z' }])
  })
})

describe('AddressVerificationPanel: the pin the staffer saw', () => {
  it('sends a null pin_set_at for a row with no pin', async () => {
    mockQueue({ pending: [row({ pin: null, evidence: { owner_gps_50m: false, signboard: true, scout_report: false, first_verification: true } })] })
    const bodies = []
    server.use(http.post(`${QUEUE}7/decide/`, async ({ request }) => { bodies.push(await request.json()); return HttpResponse.json(row({ address_status: 'wrong' })) }))
    renderPanel()
    const group = await openRow()
    fireEvent.click(within(group).getByRole('button', { name: 'Mark wrong' }))
    fireEvent.change(within(group).getByLabelText(/Reason \(the owner will see this\)/), { target: { value: 'No such shop.' } })
    fireEvent.click(within(group).getByRole('button', { name: 'Confirm wrong' }))
    await waitFor(() => expect(bodies).toEqual([{ result: 'wrong', method: 'desk', note: 'No such shop.', pin_set_at: null }]))
  })

  it('shows the server sentence and reloads the queue when the owner shared a new location meanwhile', async () => {
    const asked = mockQueue({ pending: [row()] })
    const sentence = 'The owner shared a new location since you opened this. Reload to see it before you decide.'
    server.use(http.post(`${QUEUE}7/decide/`, () => HttpResponse.json({ detail: sentence, code: 'pin_changed' }, { status: 409 })))
    renderPanel()
    const group = await openRow()
    fireEvent.click(within(group).getByRole('button', { name: 'Mark verified' }))
    fireEvent.change(within(group).getByLabelText(/What the video call showed/), { target: { value: 'Matches.' } })
    fireEvent.click(within(group).getByRole('button', { name: 'Confirm verified' }))
    expect(await within(group).findByRole('alert')).toHaveTextContent(sentence)
    await waitFor(() => expect(asked.length).toBeGreaterThan(1))
  })
})

describe('AddressVerificationPanel: mark wrong', () => {
  it('needs a reason, then sends it', async () => {
    mockQueue({ pending: [row()] })
    const bodies = []
    server.use(http.post(`${QUEUE}7/decide/`, async ({ request }) => { bodies.push(await request.json()); return HttpResponse.json(row({ address_status: 'wrong' })) }))
    renderPanel()
    const group = await openRow()
    fireEvent.click(within(group).getByRole('button', { name: 'Mark wrong' }))
    fireEvent.click(within(group).getByRole('button', { name: 'Confirm wrong' }))
    expect(await within(group).findByRole('alert')).toHaveTextContent('Write the reason the owner will see.')
    expect(bodies).toEqual([])
    fireEvent.change(within(group).getByLabelText(/Reason \(the owner will see this\)/), { target: { value: 'The pin is on the main road, not at the shop.' } })
    fireEvent.click(within(group).getByRole('button', { name: 'Confirm wrong' }))
    await waitFor(() => expect(bodies).toEqual([{ result: 'wrong', method: 'desk', note: 'The pin is on the main road, not at the shop.', pin_set_at: '2026-10-30T08:00:00Z' }]))
    expect(await screen.findByRole('status')).toHaveTextContent('address marked wrong; the owner has been told why.')
  })
})

describe('AddressVerificationPanel: maker-checker and decided rows', () => {
  it('disables both decide buttons and shows the reason when the viewer registered the business', async () => {
    const reason = "You registered this business, so someone else has to decide it."
    mockQueue({ pending: [row({ can_decide: false, blocked_reason: reason })] })
    renderPanel()
    const group = await openRow()
    expect(within(group).getByRole('button', { name: 'Mark verified' })).toBeDisabled()
    expect(within(group).getByRole('button', { name: 'Mark wrong' })).toBeDisabled()
    expect(within(group).getByText(reason)).toBeInTheDocument()
    expect(within(group).getByRole('button', { name: 'Send location link' })).toBeEnabled()
  })

  it('offers no decide buttons on a decided row and says the decision reopens on a new owner capture', async () => {
    mockQueue({
      verified: [row({ can_decide: false, blocked_reason: 'This address has already been decided.', address_status: 'verified',
        verification: { method: 'video_call', note: 'Saw the gate.', by_name: 'Yaw Boadu', at: '2026-10-30T10:00:00Z' }, evidence: { owner_gps_50m: true, signboard: true, scout_report: false, first_verification: false } })],
    })
    renderPanel()
    fireEvent.click(await screen.findByRole('button', { name: 'Verified' }))
    const group = await openRow()
    expect(within(group).queryByRole('button', { name: 'Mark verified' })).not.toBeInTheDocument()
    expect(within(group).queryByRole('button', { name: 'Mark wrong' })).not.toBeInTheDocument()
    expect(within(group).getByText(/Verified by Yaw Boadu on .* through a video call\./)).toBeInTheDocument()
    expect(within(group).getByText('Note: Saw the gate.')).toBeInTheDocument()
    expect(within(group).getByText(/reopens only when the owner shares a new location/)).toBeInTheDocument()
    expect(within(group).getByRole('button', { name: 'Send location link' })).toBeInTheDocument()
  })
})
