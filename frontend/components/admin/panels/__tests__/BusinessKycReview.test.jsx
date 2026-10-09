import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../../../mocks/server.js'
import BusinessKycReview from '../BusinessKycReview.jsx'
import { formatDateTime, formatDay } from '../portfolioParts.jsx'

const API = 'http://localhost:8000'
const LOCATION = {
  lat: 6.69, lng: -1.62, accuracy_m: 12, is_manual: false, set_by: 'scout', set_at: '2026-10-07T06:37:00Z',
  gps_address: 'AK-039-5128', address_verified: false, address_verified_by_name: null, address_verified_at: null,
}
const sheet = (overrides = {}) => ({
  owner: {
    full_name: 'Nana Adwoa Agyeman', login_phone: '+233245555531', email: null, ghana_card_number: 'GHA-723456741-3',
    needs_claim: false, claimed_at: '2026-10-07T06:52:00Z',
  },
  business: {
    business_name: "Nana's Chop Bar", business_kind: 'service', category: { id: 4, name: 'Food & drink' },
    zone: { id: 3, name: 'Asafo' }, opening_hours: 'Mon–Sat, 7:00–20:00', is_formal: false, tin_given: false,
  },
  photos: {
    signboard: 'http://localhost:8000/media/signboards/nana.jpg',
    ghana_card_front: 'http://localhost:8000/media/kyc/front.jpg', ghana_card_back: null,
  },
  location: LOCATION,
  checks: {
    exact: [], similar: [{ business_owner_id: 40, business_name: 'Nana Chop Bar & Drinks', distance_m: 38, similarity: 0.71 }],
    staff_match: false, accuracy_m: 12,
  },
  consent: {
    terms_version: 'September 2026', accepted_at: '2026-10-07T06:52:00Z', channel: 'handover', staff_name: 'Kwame Asante',
    user_agent: 'Mozilla/5.0 (Linux; Android 14)', ip: '41.66.x.x',
  },
  flags: [], registered_by_name: 'Kwame Asante', created_at: '2026-10-07T06:46:00Z',
  ...overrides,
})

function renderReview(props = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <BusinessKycReview businessId="41" {...props} />
    </QueryClientProvider>,
  )
}
const serve = (body) => server.use(http.get(`${API}/api/portfolio/businesses/41/review/`, () => HttpResponse.json(body)))

describe('BusinessKycReview', () => {
  it('shows the owner, business, photos, location, checks and consent record', async () => {
    serve(sheet())
    renderReview()
    expect(await screen.findByRole('heading', { name: 'Owner' })).toBeInTheDocument()
    expect(screen.getByText(`Registered by Kwame Asante · ${formatDateTime('2026-10-07T06:46:00Z')}`)).toBeInTheDocument()
    expect(screen.getByText('Nana Adwoa Agyeman')).toBeInTheDocument()
    expect(screen.getByText('GHA-723456741-3')).toBeInTheDocument()
    expect(screen.getByText('Services · Food & drink')).toBeInTheDocument()
    expect(screen.getByText('Asafo')).toBeInTheDocument()
    expect(screen.getByText('No (no TIN given)')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Signboard' })).toHaveAttribute('src', 'http://localhost:8000/media/signboards/nana.jpg')
    expect(screen.getByRole('img', { name: 'Ghana Card · front' })).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: 'Ghana Card · back' })).not.toBeInTheDocument()
    expect(screen.getByText('Pin 6.690000, -1.620000 · accuracy ±12 m · not moved by hand')).toBeInTheDocument()
    expect(screen.getByText(`Pin from the scout's phone · ${formatDateTime('2026-10-07T06:37:00Z')}`)).toBeInTheDocument()
    expect(screen.getByText('Ghana Post address as typed: AK-039-5128')).toBeInTheDocument()

    const checks = screen.getByRole('table', { name: 'Duplicate and self-dealing checks' })
    const exactRow = within(checks).getByRole('row', { name: /^Exact duplicate/ })
    expect(within(exactRow).getByText('None found')).toBeInTheDocument()
    expect(within(exactRow).getByText("The owner's sign-in phone was checked against every other business's sign-in, contact and payout MoMo numbers; the Ghana Post address and Ghana Card number were checked too.")).toBeInTheDocument()
    expect(screen.getByText('The app refuses a pin rougher than 100 m unless the scout places it by hand.')).toBeInTheDocument()
    expect(screen.getByText("The owner accepted the terms and typed their own password on the hand-over screen. AshantiHub doesn't keep it on the scout's phone.")).toBeInTheDocument()
    const similar = within(checks).getByRole('row', { name: /^Similar name within 50 m/ })
    expect(within(similar).getByText('Flagged')).toBeInTheDocument()
    expect(within(similar).getByText('“Nana Chop Bar & Drinks”, 38 m away, name match 0.71')).toBeInTheDocument()
    expect(within(within(checks).getByRole('row', { name: /^Self-dealing/ })).getByText('No match')).toBeInTheDocument()
    expect(within(within(checks).getByRole('row', { name: /^Pin accuracy/ })).getByText('±12 m')).toBeInTheDocument()
    expect(within(within(checks).getByRole('row', { name: /^Owner login/ })).getByText('Set')).toBeInTheDocument()

    expect(screen.getByText('September 2026')).toBeInTheDocument()
    expect(screen.getByText("Hand-over on the scout's phone")).toBeInTheDocument()
    expect(screen.getByText('Kwame Asante')).toBeInTheDocument()
    expect(screen.getByText('41.66.x.x')).toBeInTheDocument()
    expect(screen.getByText('No fraud case mentions this business.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Address verified' })).not.toBeInTheDocument()
  })

  it('shows failed checks, a missing pin and consent, and a self-dealing hold', async () => {
    serve(sheet({
      owner: { ...sheet().owner, needs_claim: true, claimed_at: null },
      location: { ...LOCATION, lat: null, lng: null, accuracy_m: null, set_by: '', set_at: null },
      checks: { exact: ['phone', 'gps_address'], similar: [], staff_match: true, accuracy_m: null },
      consent: null,
      flags: [{ id: 3, kind: 'self_dealing', kind_label: 'Self-dealing', title: "Owner phone matches Kofi Boadu's", status: 'open', created_at: '2026-10-07T07:00:00Z' }],
    }))
    renderReview()
    expect(await screen.findByText('Its KYC request is on hold until this case is decided — decide it in Fraud cases first.')).toBeInTheDocument()
    expect(screen.getByText('No map pin — owners who register online give a Ghana Post address only.')).toBeInTheDocument()
    const checks = screen.getByRole('table', { name: 'Duplicate and self-dealing checks' })
    const exact = within(checks).getByRole('row', { name: /^Exact duplicate/ })
    expect(within(exact).getByText('Found')).toBeInTheDocument()
    expect(within(exact).getByText('This phone number already belongs to another business. This Ghana Post address already belongs to another business.')).toBeInTheDocument()
    const selfDealing = within(checks).getByRole('row', { name: /^Self-dealing/ })
    expect(within(selfDealing).getByText('Match')).toBeInTheDocument()
    expect(within(selfDealing).getByText("The owner's phone matches an AshantiHub staff member's phone.")).toBeInTheDocument()
    expect(within(within(checks).getByRole('row', { name: /^Pin accuracy/ })).getByText('No pin')).toBeInTheDocument()
    expect(within(within(checks).getByRole('row', { name: /^Owner login/ })).getByText('Not set yet')).toBeInTheDocument()
    expect(screen.getByText('No consent recorded yet. The owner accepts the terms when they set their own password.')).toBeInTheDocument()
    const flags = screen.getByRole('list', { name: 'Fraud cases about this business' })
    expect(within(flags).getByText("Self-dealing · Owner phone matches Kofi Boadu's")).toBeInTheDocument()
  })

  it('records the Ghana Post address decision and shows who made it', async () => {
    let gets = 0
    let body = null
    server.use(
      http.get(`${API}/api/portfolio/businesses/41/review/`, () => {
        gets += 1
        return HttpResponse.json(gets === 1 ? sheet() : sheet({
          location: { ...LOCATION, address_verified: true, address_verified_by_name: 'Ama Boateng', address_verified_at: '2026-10-07T11:44:00Z' },
        }))
      }),
      http.post(`${API}/api/accounts/kyc/41/address-verify/`, async ({ request }) => {
        body = await request.json()
        return HttpResponse.json({ id: 41, address_verified: true, address_verified_by_name: 'Ama Boateng', address_verified_at: '2026-10-07T11:44:00Z' })
      }),
    )
    renderReview({ canRecordAddress: true })
    expect(await screen.findByText('No decision yet — Approve is refused until the address decision is recorded.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Address verified' })).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(screen.getByRole('button', { name: 'Address verified' }))
    await waitFor(() => expect(body).toEqual({ verified: true }))
    expect(await screen.findByText(`✓ Address verified by Ama Boateng · ${formatDateTime('2026-10-07T11:44:00Z')}`)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Address verified' })).toHaveAttribute('aria-pressed', 'true')
  })

  it("shows the server's reason when the address decision is refused", async () => {
    serve(sheet())
    server.use(http.post(`${API}/api/accounts/kyc/41/address-verify/`, () => HttpResponse.json(
      { detail: 'You do not have permission to perform this action.' }, { status: 403 },
    )))
    renderReview({ canRecordAddress: true })
    fireEvent.click(await screen.findByRole('button', { name: 'Address wrong' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('You do not have permission to perform this action.')
  })

  it('says when a field scout corrected the address', async () => {
    serve(sheet({ address_correction: { scout_name: 'Efua Mensah', corrected_address: 'AK-100-9999', at: '2026-10-08T09:30:00Z' } }))
    renderReview()
    expect(await screen.findByText(
      `Address corrected by field scout Efua Mensah on ${formatDay('2026-10-08T09:30:00Z')} to AK-100-9999 — record the address decision before approving.`,
    )).toBeInTheDocument()
  })

  it('drops the record-the-decision suffix once the address decision is recorded', async () => {
    serve(sheet({
      address_correction: { scout_name: 'Efua Mensah', corrected_address: 'AK-100-9999', at: '2026-10-08T09:30:00Z' },
      location: { ...LOCATION, address_verified: true, address_verified_by_name: 'Ama Boateng', address_verified_at: '2026-10-09T08:00:00Z' },
    }))
    renderReview()
    expect(await screen.findByText(
      `Address corrected by field scout Efua Mensah on ${formatDay('2026-10-08T09:30:00Z')} to AK-100-9999`,
    )).toBeInTheDocument()
    expect(screen.queryByText(/record the address decision before approving/)).not.toBeInTheDocument()
  })

  it('shows no correction line without one', async () => {
    serve(sheet({ address_correction: null }))
    renderReview()
    await screen.findByRole('heading', { name: 'Owner' })
    expect(screen.queryByText(/Address corrected by field scout/)).not.toBeInTheDocument()
  })

  it('tells someone who may not open the sheet so', async () => {
    server.use(http.get(`${API}/api/portfolio/businesses/41/review/`, () => HttpResponse.json({ detail: 'Forbidden' }, { status: 403 })))
    renderReview()
    expect(await screen.findByText('The KYC review sheet is for Operations and Super Admin.')).toBeInTheDocument()
  })
})
