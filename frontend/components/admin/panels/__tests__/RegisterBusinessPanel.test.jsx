import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { server } from '../../../../mocks/server.js'
import RegisterBusinessPanel from '../RegisterBusinessPanel.jsx'

const DRAFT_KEY = 'ashantihub.registerDraft.9'
const auth = { user: { id: 9, full_name: 'Kwame Asante', role: 'scout' }, hasPermission: () => true }
const NO_MATCH = { exact: [], similar: [], staff_match: false }
const REGISTERED = { id: 41, business_name: 'Asafo Hair & Beauty', approval_id: 7, approver_name: 'Ama Boateng', flags: [], needs_claim: true }

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}><RegisterBusinessPanel auth={auth} /></QueryClientProvider>)
}

function stubGeolocation(accuracy) {
  const getCurrentPosition = vi.fn((ok) => ok({
    coords: { latitude: 6.6885, longitude: -1.6244, accuracy }, timestamp: Date.parse('2026-10-08T10:21:00Z'),
  }))
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition } })
  return getCurrentPosition
}

// The register request carries jsdom File parts, which can't be read back
// inside an MSW handler under this setup (see EventSubmissionPanel.test.jsx),
// so the handler records only the content type and the test reads the fields
// from FormData.prototype.append.
function mockRegistration({ check = NO_MATCH, register } = {}) {
  const seen = { check: null, registerContentType: null }
  server.use(
    http.post('http://localhost:8000/api/portfolio/register/check/', async ({ request }) => {
      seen.check = await request.json()
      return HttpResponse.json(check)
    }),
    http.post('http://localhost:8000/api/portfolio/register/', ({ request }) => {
      seen.registerContentType = request.headers.get('content-type')
      return register ? register() : HttpResponse.json(REGISTERED, { status: 201 })
    }),
  )
  return seen
}

const type = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } })

async function fillOwnerAndBusiness({ email = '' } = {}) {
  type("Owner's full name (as on Ghana Card)", 'Gifty Asantewaa')
  type("Owner's phone", '020 123 4761')
  if (email) type("Owner's email (optional)", email)
  type('Business name (as on the signboard)', 'Asafo Hair & Beauty')
  type('Kind of business', 'service')
  await screen.findByRole('option', { name: 'Hotels' })
  type('Category', '1')
  fireEvent.click(screen.getByRole('button', { name: 'Next: Location' }))
}

async function fillLocation() {
  fireEvent.click(await screen.findByRole('button', { name: 'Use my location' }))
  expect(await screen.findByText('Accuracy ±12 m')).toBeInTheDocument()
  await screen.findByRole('option', { name: 'Manhyia' })
  type('Area', '1')
  type('Ghana Post address', 'AK-112-0384')
  fireEvent.click(screen.getByRole('button', { name: 'Next: Photos' }))
}

function takePhotos() {
  fireEvent.change(screen.getByLabelText('Signboard photo'), { target: { files: [new File(['sign'], 'sign.jpg', { type: 'image/jpeg' })] } })
  fireEvent.change(screen.getByLabelText('Ghana Card front photo'), { target: { files: [new File(['card'], 'card.jpg', { type: 'image/jpeg' })] } })
  fireEvent.click(screen.getByRole('button', { name: 'Next: Review' }))
}

async function submitRegistration({ email = '' } = {}) {
  renderPanel()
  await fillOwnerAndBusiness({ email })
  await fillLocation()
  takePhotos()
  await screen.findByText(/No exact match/)
  fireEvent.click(screen.getByRole('button', { name: 'Submit for KYC' }))
  await screen.findByText('Sent to Ama Boateng for KYC')
}

beforeEach(() => {
  localStorage.clear()
  stubGeolocation(12)
})
afterEach(() => {
  delete navigator.geolocation
  vi.restoreAllMocks()
  localStorage.clear()
})

describe('RegisterBusinessPanel — the four steps', () => {
  it('walks owner, location, photos and review, then submits multipart and clears the draft', async () => {
    const seen = mockRegistration()
    renderPanel()
    await fillOwnerAndBusiness({ email: 'gifty.a@example.com' })
    await fillLocation()
    takePhotos()
    expect(await screen.findByText(/No exact match/)).toBeInTheDocument()
    expect(seen.check).toEqual({
      owner_phone: '020 123 4761', business_name: 'Asafo Hair & Beauty', gps_address: 'AK-112-0384',
      lat: 6.6885, lng: -1.6244, ghana_card_number: '',
    })
    expect(screen.getByText("Owner's phone doesn't match any AshantiHub staff member.")).toBeInTheDocument()
    // Photos never reach the draft on the phone.
    expect(localStorage.getItem(DRAFT_KEY)).not.toMatch(/sign\.jpg|card\.jpg/)

    const append = vi.spyOn(FormData.prototype, 'append')
    fireEvent.click(screen.getByRole('button', { name: 'Submit for KYC' }))
    expect(await screen.findByText('Sent to Ama Boateng for KYC')).toBeInTheDocument()
    expect(seen.registerContentType).toMatch(/^multipart\/form-data/)
    const sent = Object.fromEntries(append.mock.calls.map(([key, value]) => [key, value]))
    expect(sent).toMatchObject({
      owner_full_name: 'Gifty Asantewaa', owner_phone: '020 123 4761', owner_email: 'gifty.a@example.com',
      business_name: 'Asafo Hair & Beauty', business_kind: 'service', business_category: '1', zone: '1',
      gps_address: 'AK-112-0384', lat: '6.688500', lng: '-1.624400', location_accuracy_m: '12', location_is_manual: 'false',
    })
    expect(sent.signboard_photo.name).toBe('sign.jpg')
    expect(sent.ghana_card_front.name).toBe('card.jpg')
    expect(sent).not.toHaveProperty('ghana_card_number')
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull()
    expect(screen.getByText(/The draft has been cleared from this phone/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Hand the phone to Gifty' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Owner not here? Send a link' })).toBeInTheDocument()
  })

  it('offers only the categories of the chosen kind of business', async () => {
    renderPanel()
    type('Kind of business', 'product')
    expect(await screen.findByRole('option', { name: 'Food' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Hotels' })).not.toBeInTheDocument()
    type('Kind of business', 'service')
    expect(await screen.findByRole('option', { name: 'Hotels' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Food' })).not.toBeInTheDocument()
  })

  it('says what is missing before moving on', () => {
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Next: Location' }))
    expect(screen.getByText("Add the owner's full name.")).toBeInTheDocument()
    expect(screen.getByLabelText("Owner's full name (as on Ghana Card)")).toBeInTheDocument()
  })
})

describe('RegisterBusinessPanel — the draft on this phone', () => {
  it('keeps typed fields as a draft, and asks for the photos again after a reload', async () => {
    const { unmount } = renderPanel()
    type("Owner's full name (as on Ghana Card)", 'Gifty Asantewaa')
    expect(await screen.findByText(/Draft saved on this phone · \d{2}:\d{2}/)).toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem(DRAFT_KEY)).form.owner_full_name).toBe('Gifty Asantewaa')
    unmount()
    renderPanel()
    expect(screen.getByLabelText("Owner's full name (as on Ghana Card)")).toHaveValue('Gifty Asantewaa')
    expect(screen.getByText(/Draft saved on this phone/)).toBeInTheDocument()
    expect(screen.getByText("Photos aren't kept in the draft — take them again on step 3.")).toBeInTheDocument()
  })

  it('discards the draft on request', async () => {
    renderPanel()
    type("Owner's full name (as on Ghana Card)", 'Gifty Asantewaa')
    fireEvent.click(await screen.findByRole('button', { name: 'Discard this draft' }))
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull()
    expect(screen.getByLabelText("Owner's full name (as on Ghana Card)")).toHaveValue('')
  })

  it('still works when the phone will not store a draft', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceededError') })
    renderPanel()
    type("Owner's full name (as on Ghana Card)", 'Gifty Asantewaa')
    expect(await screen.findByText("This phone isn't keeping a draft — finish in one go.")).toBeInTheDocument()
    expect(screen.getByLabelText("Owner's full name (as on Ghana Card)")).toHaveValue('Gifty Asantewaa')
  })
})

describe('RegisterBusinessPanel — the map pin', () => {
  it('refuses a fix rougher than 100 m until the scout tries again or places the pin by hand', async () => {
    const getCurrentPosition = stubGeolocation(140)
    renderPanel()
    await fillOwnerAndBusiness()
    fireEvent.click(await screen.findByRole('button', { name: 'Use my location' }))
    expect(await screen.findByText('Location too rough: ±140 m')).toBeInTheDocument()
    await screen.findByRole('option', { name: 'Manhyia' })
    type('Area', '1')
    type('Ghana Post address', 'AK-112-0384')
    fireEvent.click(screen.getByRole('button', { name: 'Next: Photos' }))
    expect(screen.getByText(/Try again, or place the pin by hand/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Signboard photo')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(getCurrentPosition).toHaveBeenCalledTimes(2)
    fireEvent.click(screen.getByRole('button', { name: 'Place pin by hand' }))
    fireEvent.click(screen.getByRole('button', { name: 'drop-pin' })) // the LocationPicker stub (test/setup.js)
    expect(screen.getByText('Placed by hand')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Next: Photos' }))
    expect(await screen.findByLabelText('Signboard photo')).toBeInTheDocument()
  })
})

describe('RegisterBusinessPanel — accuracy rounding', () => {
  it('treats a 100.4 m fix as ±101 m, too rough', async () => {
    stubGeolocation(100.4)
    renderPanel()
    await fillOwnerAndBusiness()
    fireEvent.click(await screen.findByRole('button', { name: 'Use my location' }))
    expect(await screen.findByText('Location too rough: ±101 m')).toBeInTheDocument()
  })
})

describe('RegisterBusinessPanel — flags', () => {
  it("shows a flag's kind only, never its title (which can name a staff member)", async () => {
    mockRegistration({ register: () => HttpResponse.json(
      { ...REGISTERED, flags: [{ id: 5, kind_label: 'Self-dealing', title: 'Owner phone matches Efua Mensah' }] }, { status: 201 },
    ) })
    await submitRegistration()
    expect(screen.getByText('Flagged for Operations: Self-dealing')).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('Efua Mensah')
  })
})

describe('RegisterBusinessPanel — duplicate and self-dealing checks', () => {
  it('blocks the submit when the phone already belongs to a business', async () => {
    mockRegistration({ check: { exact: ['phone'], similar: [], staff_match: false } })
    renderPanel()
    await fillOwnerAndBusiness()
    await fillLocation()
    takePhotos()
    expect(await screen.findByText('Already registered — ask Operations.')).toBeInTheDocument()
    expect(screen.getByText('This phone number already belongs to another business.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Submit for KYC' })).toBeDisabled()
  })

  it('warns about a similar business nearby and a staff phone, but still lets the scout submit', async () => {
    mockRegistration({ check: {
      exact: [], staff_match: true,
      similar: [{ business_owner_id: 3, business_name: 'Asafo Hair Studio', distance_m: 40, similarity: 0.71 }],
    } })
    renderPanel()
    await fillOwnerAndBusiness()
    await fillLocation()
    takePhotos()
    expect(await screen.findByText('A business with a similar name is 40 m away — Asafo Hair Studio. You can still submit; Operations will review.')).toBeInTheDocument()
    expect(screen.getByText(/matches an AshantiHub staff member's phone/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Submit for KYC' })).toBeEnabled()
  })

  it("shows the server's duplicate refusal and keeps the draft", async () => {
    mockRegistration({ register: () => HttpResponse.json(
      { detail: 'Already registered — ask Operations.', code: 'duplicate', matched: ['gps_address'] }, { status: 400 },
    ) })
    renderPanel()
    await fillOwnerAndBusiness()
    await fillLocation()
    takePhotos()
    await screen.findByText(/No exact match/)
    fireEvent.click(screen.getByRole('button', { name: 'Submit for KYC' }))
    expect(await screen.findByText('Already registered — ask Operations.')).toBeInTheDocument()
    expect(screen.getByText('Matched: Ghana Post address')).toBeInTheDocument()
    expect(localStorage.getItem(DRAFT_KEY)).not.toBeNull()
  })
})

describe('RegisterBusinessPanel — the owner login', () => {
  it('sends the owner a claim link by email when they are not there', async () => {
    mockRegistration()
    let linkCalls = 0
    server.use(http.post('http://localhost:8000/api/portfolio/businesses/41/claim-link/', () => {
      linkCalls += 1
      return HttpResponse.json({ sent_to: 'gi•••@example.com', expires_at: '2026-10-15T10:52:00Z' })
    }))
    await submitRegistration({ email: 'gifty.a@example.com' })
    fireEvent.click(screen.getByRole('button', { name: 'Owner not here? Send a link' }))
    expect(screen.getByText('Not connected yet')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Send link by email' }))
    expect(await screen.findByText(/Link sent to gi•••@example\.com/)).toBeInTheDocument()
    expect(linkCalls).toBe(1)
  })

  it('cannot send a link without an email, and says why', async () => {
    mockRegistration()
    await submitRegistration()
    fireEvent.click(screen.getByRole('button', { name: 'Owner not here? Send a link' }))
    expect(screen.getByText("Add the owner's email first — text messages (SMS) aren't connected yet.")).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send link by email' })).toBeDisabled()
  })

  it('hands the phone to the owner over the whole screen, and back', async () => {
    mockRegistration()
    await submitRegistration()
    fireEvent.click(screen.getByRole('button', { name: 'Hand the phone to Gifty' }))
    expect(await screen.findByRole('dialog', { name: 'Owner setup' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Owner not here? Send a link' })).not.toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel — hand back to Kwame' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Owner not here? Send a link' })).toBeInTheDocument()
  })
})
