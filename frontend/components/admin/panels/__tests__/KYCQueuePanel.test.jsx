import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../../../mocks/server.js'
import KYCQueuePanel from '../KYCQueuePanel.jsx'

const API = 'http://localhost:8000'
const owner = (overrides = {}) => ({
  id: 41, full_name: 'Nana Adwoa Agyeman', login_phone: '+233245555531', kyc_status: 'pending', kyc_rejection_reason: null,
  created_at: '2026-10-07T06:46:00Z', reviewed_by_name: null, reviewed_at: null,
  registration_channel: 'scout', registered_by_name: 'Kwame Asante', registered_by_role: 'Scout', open_fraud_flags: [], pending_approval_id: 9,
  ...overrides,
})
const detailOf = (o, extra = {}) => ({
  ...o, email: '',
  profile: {
    gps_address: 'AK-039-5128', business_contact_phone: o.login_phone, is_formal: false,
    address_verified: true, address_verified_by_name: 'Ama Boateng', address_verified_at: '2026-10-07T11:44:00Z',
  },
  business_name: "Nana's Chop Bar", business_category_name: 'Food & drink', zone_name: 'Asafo',
  lat: '6.690000', lng: '-1.620000', location_accuracy_m: 12, location_is_manual: false,
  signboard_photo: 'http://localhost:8000/media/signboards/nana.jpg',
  ...extra,
})

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={queryClient}><KYCQueuePanel /></QueryClientProvider>)
}
// The pending/:status list first, so ".../kyc/pending/" never reaches ":id".
function mockQueue(pending, details = {}) {
  server.use(
    http.get(`${API}/api/accounts/kyc/pending/`, ({ request }) => {
      const status = new URL(request.url).searchParams.get('status') || 'pending'
      return HttpResponse.json(status === 'pending' ? pending : [])
    }),
    http.get(`${API}/api/accounts/kyc/:id/`, ({ params }) => HttpResponse.json(
      details[params.id] || detailOf(pending.find((o) => String(o.id) === params.id)),
    )),
  )
}
async function openApproveReady(name) {
  const row = await screen.findByRole('group', { name })
  fireEvent.click(within(row).getByText('👁️ View Details'))
  await waitFor(() => expect(within(row).getByText('✓ Approve')).toBeEnabled())
  return row
}

describe('KYCQueuePanel (staff phase 2A)', () => {
  it('says who registered each business, whether it is also in Approvals, and its open fraud cases', async () => {
    mockQueue([
      owner({ open_fraud_flags: [{ id: 3, kind: 'similar_nearby', kind_label: 'Similar business nearby', title: 'Nana Chop Bar & Drinks is 38 m away' }] }),
      owner({ id: 42, full_name: 'Kofi Asamoah', registration_channel: 'self', registered_by_name: null, registered_by_role: null, pending_approval_id: null }),
      owner({ id: 43, full_name: 'Abena Owusu', registered_by_name: 'Simon Peter', registered_by_role: 'Super Admin', pending_approval_id: null }),
    ])
    renderPanel()
    expect(screen.getByText("Approving a scout's registration here also settles its request in Approvals.")).toBeInTheDocument()
    const nana = await screen.findByRole('group', { name: 'Nana Adwoa Agyeman' })
    expect(within(nana).getByText('Registered by Kwame Asante (Scout) · also in Approvals')).toBeInTheDocument()
    expect(within(nana).getByText('🚩 Similar business nearby')).toHaveAttribute('title', 'Nana Chop Bar & Drinks is 38 m away')
    expect(within(screen.getByRole('group', { name: 'Kofi Asamoah' })).getByText('Registered online by the owner')).toBeInTheDocument()
    const abena = screen.getByRole('group', { name: 'Abena Owusu' })
    expect(within(abena).getByText('Registered by Simon Peter (Super Admin)')).toBeInTheDocument()
    expect(within(abena).queryByText(/also in Approvals/)).not.toBeInTheDocument()
  })

  it.each([
    [400, 'Decide the self-dealing case in Fraud cases first.'],
    [400, 'This business has already been decided.'],
    [403, "You supplied or changed this business's details, so someone else decides its KYC."],
  ])("shows the server's reason when Approve is refused (%i %s)", async (statusCode, message) => {
    mockQueue([owner()])
    server.use(http.post(`${API}/api/accounts/kyc/41/approve/`, () => HttpResponse.json({ detail: message }, { status: statusCode })))
    renderPanel()
    const row = await openApproveReady('Nana Adwoa Agyeman')
    fireEvent.click(within(row).getByText('✓ Approve'))
    expect(await within(row).findByRole('alert')).toHaveTextContent(message)
  })

  it('keeps the generic message when the server itself fails', async () => {
    mockQueue([owner()])
    server.use(http.post(`${API}/api/accounts/kyc/41/approve/`, () => HttpResponse.json({ detail: 'Server error' }, { status: 500 })))
    renderPanel()
    const row = await openApproveReady('Nana Adwoa Agyeman')
    fireEvent.click(within(row).getByText('✓ Approve'))
    expect(await within(row).findByRole('alert')).toHaveTextContent('Could not approve this submission. Please try again.')
  })

  it("shows the server's reason when Reject is refused", async () => {
    mockQueue([owner()])
    server.use(http.post(`${API}/api/accounts/kyc/41/reject/`, () => HttpResponse.json(
      { detail: 'This business has already been decided.' }, { status: 400 },
    )))
    renderPanel()
    const row = await openApproveReady('Nana Adwoa Agyeman')
    fireEvent.click(within(row).getByText('✕ Reject'))
    fireEvent.change(within(row).getByPlaceholderText('Rejection reason'), { target: { value: 'Blurry card' } })
    fireEvent.click(within(row).getByText('Confirm reject'))
    expect(await within(row).findByRole('alert')).toHaveTextContent('This business has already been decided.')
  })

  it('shows the business, its map pin and its signboard in the details', async () => {
    const kofi = owner({ id: 42, full_name: 'Kofi Asamoah', registration_channel: 'self', registered_by_name: null, registered_by_role: null, pending_approval_id: null })
    mockQueue([owner(), kofi], {
      42: detailOf(kofi, {
        business_name: 'Manhyia Tailoring', business_category_name: null, zone_name: 'Manhyia',
        lat: null, lng: null, location_accuracy_m: null, signboard_photo: null,
      }),
    })
    renderPanel()
    const nana = await screen.findByRole('group', { name: 'Nana Adwoa Agyeman' })
    fireEvent.click(within(nana).getByText('👁️ View Details'))
    expect(await within(nana).findByText("Nana's Chop Bar")).toBeInTheDocument()
    expect(within(nana).getByText('Food & drink')).toBeInTheDocument()
    expect(within(nana).getByText('6.69000, -1.62000 · ±12 m')).toBeInTheDocument()
    expect(within(nana).getByRole('img', { name: 'Signboard' })).toHaveAttribute('src', 'http://localhost:8000/media/signboards/nana.jpg')
    const kofiRow = screen.getByRole('group', { name: 'Kofi Asamoah' })
    fireEvent.click(within(kofiRow).getByText('👁️ View Details'))
    expect(await within(kofiRow).findByText('No map pin')).toBeInTheDocument()
    expect(within(kofiRow).getByText(/Owners who register online give a Ghana Post address only/)).toBeInTheDocument()
    expect(within(kofiRow).queryByRole('img', { name: 'Signboard' })).not.toBeInTheDocument()
  })
})
