import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../../../mocks/server.js'
import KYCQueuePanel from '../KYCQueuePanel.jsx'

const API = 'http://localhost:8000'
const row = (overrides = {}) => ({
  id: 41, full_name: 'Nana Adwoa Agyeman', business_name: "Nana's Chop Bar", login_phone: '+233****5531',
  registration_channel: 'scout', registered_by_name: 'Kwame Asante', registered_by_role: 'Scout',
  kyc_status: 'approved', identity_status: 'pending', identity_submitted_at: '2026-10-07T06:46:00Z',
  identity_reviewed_at: null, identity_reviewed_by_name: null, identity_rejection_reason: '',
  ...overrides,
})
const detail = (profile = {}) => ({
  id: 41, full_name: 'Nana Adwoa Agyeman', login_phone: '+233****5531', email: '', kyc_status: 'approved',
  profile: {
    is_formal: false, ghana_card_number: '', ghana_card_front_image: null, ghana_card_back_image: null,
    business_reg_certificate: null, tin: '', identity_status: 'pending', ...profile,
  },
})

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={queryClient}><KYCQueuePanel /></QueryClientProvider>)
}
// `lists` maps a ?status= value to the rows served; `calls` records each GET.
function mockIdentity(lists, profile = {}) {
  const calls = []
  server.use(
    http.get(`${API}/api/accounts/kyc/identity/pending/`, ({ request }) => {
      const status = new URL(request.url).searchParams.get('status') || 'pending'
      calls.push(status)
      return HttpResponse.json(lists[status] || [])
    }),
    http.get(`${API}/api/accounts/kyc/:id/`, () => HttpResponse.json(detail(profile))),
  )
  return calls
}
async function openIdentity() {
  fireEvent.click(screen.getByRole('button', { name: 'Identity documents' }))
}

describe('Identity review in the KYC queue', () => {
  it('identity tab lists pending identity submissions', async () => {
    mockIdentity({ pending: [row(), row({ id: 42, full_name: 'Kofi Asamoah', business_name: '', registration_channel: 'self', registered_by_name: null, registered_by_role: null })] })
    renderPanel()
    await openIdentity()
    const nana = await screen.findByRole('group', { name: 'Nana Adwoa Agyeman' })
    expect(within(nana).getByText(/Nana Adwoa Agyeman · Nana's Chop Bar/)).toBeInTheDocument()
    expect(within(nana).getByText(/\+233\*\*\*\*5531 • identity submitted/)).toBeInTheDocument()
    expect(within(nana).getByText('Registered by Kwame Asante (Scout)')).toBeInTheDocument()
    expect(within(screen.getByRole('group', { name: 'Kofi Asamoah' })).getByText('Registered online by the owner')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Pending · 2$/ })).toBeInTheDocument()
  })

  it('the address queue stays the default view', async () => {
    mockIdentity({})
    renderPanel()
    expect(screen.getByRole('button', { name: 'Address checks' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Identity documents' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('review shows card and certificate when present', async () => {
    mockIdentity({ pending: [row()] }, {
      is_formal: true, ghana_card_number: 'GHA-723456741-3',
      ghana_card_front_image: 'http://localhost:8000/media/kyc/front.jpg', ghana_card_back_image: 'http://localhost:8000/media/kyc/back.jpg',
      business_reg_certificate: 'http://localhost:8000/media/kyc/cert.pdf', tin: 'C0012345678',
    })
    renderPanel()
    await openIdentity()
    const r = await screen.findByRole('group', { name: 'Nana Adwoa Agyeman' })
    fireEvent.click(within(r).getByRole('button', { name: /View documents/ }))
    expect(await within(r).findByText('GHA-723456741-3')).toBeInTheDocument()
    expect(within(r).getByRole('img', { name: 'Front' })).toHaveAttribute('src', 'http://localhost:8000/media/kyc/front.jpg')
    expect(within(r).getByRole('img', { name: 'Back' })).toHaveAttribute('src', 'http://localhost:8000/media/kyc/back.jpg')
    expect(within(r).getByRole('link', { name: /View business registration certificate/ })).toHaveAttribute('href', 'http://localhost:8000/media/kyc/cert.pdf')
    expect(within(r).getByText('C0012345678')).toBeInTheDocument()
    expect(within(r).getByText('Yes')).toBeInTheDocument()
    expect(within(r).queryByText('Not provided')).not.toBeInTheDocument()
  })

  it('review shows a plain not provided for each missing document', async () => {
    mockIdentity({ pending: [row()] })
    renderPanel()
    await openIdentity()
    const r = await screen.findByRole('group', { name: 'Nana Adwoa Agyeman' })
    fireEvent.click(within(r).getByRole('button', { name: /View documents/ }))
    await within(r).findByText('Ghana Card number')
    // card number, front, back, certificate and TIN
    expect(within(r).getAllByText('Not provided')).toHaveLength(5)
    expect(within(r).queryByRole('img')).not.toBeInTheDocument()
  })

  it('approving identity posts to kyc/<id>/identity/approve/ and refetches', async () => {
    const calls = mockIdentity({ pending: [row()] })
    let posted = 0
    server.use(http.post(`${API}/api/accounts/kyc/41/identity/approve/`, () => { posted += 1; return HttpResponse.json({ id: 41, identity_status: 'verified' }) }))
    renderPanel()
    await openIdentity()
    const r = await screen.findByRole('group', { name: 'Nana Adwoa Agyeman' })
    const before = calls.length
    fireEvent.click(within(r).getByRole('button', { name: '✓ Approve' }))
    await waitFor(() => expect(posted).toBe(1))
    await waitFor(() => expect(calls.length).toBeGreaterThan(before))
  })

  it('rejecting needs a reason', async () => {
    mockIdentity({ pending: [row()] })
    let body = null
    server.use(http.post(`${API}/api/accounts/kyc/41/identity/reject/`, async ({ request }) => {
      body = await request.json()
      return HttpResponse.json({ id: 41, identity_status: 'rejected' })
    }))
    renderPanel()
    await openIdentity()
    const r = await screen.findByRole('group', { name: 'Nana Adwoa Agyeman' })
    fireEvent.click(within(r).getByRole('button', { name: 'Reject…' }))
    const confirm = within(r).getByRole('button', { name: 'Confirm reject' })
    expect(confirm).toBeDisabled()
    fireEvent.change(within(r).getByRole('textbox', { name: 'Rejection reason' }), { target: { value: '   ' } })
    expect(confirm).toBeDisabled()
    fireEvent.change(within(r).getByRole('textbox', { name: 'Rejection reason' }), { target: { value: 'Card photo is blurry' } })
    expect(confirm).toBeEnabled()
    fireEvent.click(confirm)
    await waitFor(() => expect(body).toEqual({ reason: 'Card photo is blurry' }))
  })

  it('history tabs show the identity reviewer and reason, not the address ones', async () => {
    mockIdentity({
      approved: [row({
        identity_status: 'verified', identity_reviewed_by_name: 'Ama Boateng', identity_reviewed_at: '2026-10-09T08:00:00Z',
        kyc_rejection_reason: 'KYC reason that must not show', reviewed_by_name: 'Wrong Person',
      })],
      rejected: [row({
        id: 43, full_name: 'Abena Owusu', identity_status: 'rejected', identity_reviewed_by_name: 'Ama Boateng',
        identity_reviewed_at: '2026-10-09T09:00:00Z', identity_rejection_reason: 'Card photo is blurry',
        kyc_rejection_reason: 'KYC reason that must not show',
      })],
    })
    renderPanel()
    await openIdentity()
    fireEvent.click(await screen.findByRole('button', { name: /^Verified/ }))
    const approved = await screen.findByRole('group', { name: 'Nana Adwoa Agyeman' })
    expect(within(approved).getByText(/Verified by Ama Boateng • 2026-10-09/)).toBeInTheDocument()
    expect(screen.queryByText(/Wrong Person/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^Rejected/ }))
    const rejected = await screen.findByRole('group', { name: 'Abena Owusu' })
    expect(within(rejected).getByText('✕ Rejected: Card photo is blurry')).toBeInTheDocument()
    expect(within(rejected).getByText(/Decided by Ama Boateng/)).toBeInTheDocument()
    expect(screen.queryByText(/KYC reason that must not show/)).not.toBeInTheDocument()
  })

  it('shows the 403 refusal message when the registrar tries to decide', async () => {
    mockIdentity({ pending: [row()] })
    server.use(http.post(`${API}/api/accounts/kyc/41/identity/approve/`, () => HttpResponse.json(
      { detail: "You supplied or changed this business's details, so someone else decides its identity." }, { status: 403 },
    )))
    renderPanel()
    await openIdentity()
    const r = await screen.findByRole('group', { name: 'Nana Adwoa Agyeman' })
    fireEvent.click(within(r).getByRole('button', { name: '✓ Approve' }))
    expect(await within(r).findByRole('alert')).toHaveTextContent("You supplied or changed this business's details, so someone else decides its identity.")
  })

  it('shows a refusal on reject too, and keeps a generic line for a server failure', async () => {
    mockIdentity({ pending: [row()] })
    server.use(http.post(`${API}/api/accounts/kyc/41/identity/reject/`, () => HttpResponse.json({ detail: 'Server error' }, { status: 500 })))
    renderPanel()
    await openIdentity()
    const r = await screen.findByRole('group', { name: 'Nana Adwoa Agyeman' })
    fireEvent.click(within(r).getByRole('button', { name: 'Reject…' }))
    fireEvent.change(within(r).getByRole('textbox', { name: 'Rejection reason' }), { target: { value: 'No' } })
    fireEvent.click(within(r).getByRole('button', { name: 'Confirm reject' }))
    expect(await within(r).findByRole('alert')).toHaveTextContent('Could not reject this identity. Please try again.')
  })

  it('re-review posts to identity/re-review/', async () => {
    mockIdentity({ rejected: [row({ identity_status: 'rejected', identity_rejection_reason: 'Blurry' })] })
    let posted = 0
    server.use(http.post(`${API}/api/accounts/kyc/41/identity/re-review/`, () => { posted += 1; return HttpResponse.json({ id: 41, identity_status: 'pending' }) }))
    renderPanel()
    await openIdentity()
    fireEvent.click(await screen.findByRole('button', { name: /^Rejected/ }))
    const r = await screen.findByRole('group', { name: 'Nana Adwoa Agyeman' })
    fireEvent.click(within(r).getByRole('button', { name: /Review Again/ }))
    await waitFor(() => expect(posted).toBe(1))
  })
})
