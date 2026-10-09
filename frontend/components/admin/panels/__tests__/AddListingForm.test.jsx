import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiPost } from '../../../../apiClient.js'
import { server } from '../../../../mocks/server.js'
import AddListingForm from '../AddListingForm.jsx'

const geo = vi.hoisted(() => ({ locate: vi.fn(), position: null }))
vi.mock('../../../../hooks/useDevicePosition.js', () => ({
  useDevicePosition: () => ({ position: geo.position, error: null, locating: false, locate: geo.locate }),
}))

const API = 'http://localhost:8000'
const META = { categories: [{ id: 2, name: 'Fabrics & clothing' }, { id: 5, name: 'Kente & crafts' }], zones: [{ id: 3, name: 'Bantama' }], required_answers: {} }
const business = (overrides = {}) => ({
  id: 12, business_name: 'Adwoa Fabrics', owner_name: 'Adwoa Frimpong', zone: { id: 3, name: 'Bantama' },
  kyc_status: 'verified', business_kind: 'product', listings: [], can_manage: true, ...overrides,
})
let photoId = 100

function serve(b = business()) {
  server.use(
    http.get(`${API}/api/portfolio/businesses/12/`, () => HttpResponse.json(b)),
    http.get(`${API}/api/portfolio/meta/listing-form/`, () => HttpResponse.json(META)),
  )
}
// Reading a multipart body that holds a jsdom File hangs under this test
// setup (see EventSubmissionPanel.test.jsx), so the handler only records the
// call and its content type; the fields are read from FormData.prototype.append.
function stagePhotos(uploads) {
  server.use(http.post(`${API}/api/portfolio/businesses/12/photos/`, ({ request }) => {
    uploads.push({ contentType: request.headers.get('content-type') })
    photoId += 1
    return HttpResponse.json({ id: photoId, url: `${API}/media/staged_photos/${photoId}.jpg`, created_at: '2026-10-08T10:00:00Z' }, { status: 201 })
  }))
}
const shot = () => new File(['jpeg-bytes'], 'shot.jpg', { type: 'image/jpeg' })
function renderForm(props = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <AddListingForm businessId="12" onBack={() => {}} onSent={() => {}} {...props} />
    </QueryClientProvider>,
  )
}
async function fillProduct() {
  fireEvent.change(await screen.findByLabelText(/Take photo/), { target: { files: [shot()] } })
  await screen.findByRole('img', { name: 'Photo 1' })
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Ankara wrap skirt' } })
  fireEvent.change(screen.getByLabelText('Category'), { target: { value: '2' } })
  fireEvent.change(screen.getByLabelText('Price (GH₵)'), { target: { value: '180' } })
  fireEvent.change(screen.getByLabelText('In stock'), { target: { value: '4' } })
  fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Cotton wax print, made to order' } })
  fireEvent.click(within(screen.getByRole('group', { name: 'Comes with a warranty?' })).getByRole('radio', { name: 'No' }))
  fireEvent.click(within(screen.getByRole('group', { name: 'Can it expire?' })).getByRole('radio', { name: 'No' }))
  fireEvent.change(screen.getByLabelText('Return policy'), { target: { value: 'Exchange within 7 days if unworn' } })
  fireEvent.change(screen.getByLabelText('Why add it (Operations sees this)'), { target: { value: 'Owner showed me the new stock' } })
}

let append
beforeEach(() => {
  append = vi.spyOn(FormData.prototype, 'append')
  photoId = 100
  geo.locate.mockClear()
  geo.position = { lat: 6.7, lng: -1.62, accuracy: 9, at: new Date().toISOString() }
})

afterEach(() => append.mockRestore())

const appended = () => append.mock.calls.map(([key, value]) => [key, value])

describe('AddListingForm', () => {
  it('takes photos in the app, stamped with where the phone was, and sends the product for approval', async () => {
    const uploads = []
    let body = null
    serve()
    stagePhotos(uploads)
    server.use(http.post(`${API}/api/portfolio/businesses/12/listings/`, async ({ request }) => {
      body = await request.json()
      return HttpResponse.json({ approval_id: 33, approver_name: 'Ama Boateng' }, { status: 201 })
    }))
    renderForm()
    expect(await screen.findByText(/registered for products/)).toBeInTheDocument()
    const send = screen.getByRole('button', { name: 'Send for approval' })
    expect(send).toBeDisabled()
    fireEvent.click(screen.getByLabelText(/Take photo/))
    expect(geo.locate).toHaveBeenCalled()
    await fillProduct()
    expect(screen.getByRole('img', { name: 'Photo 1' })).toHaveAttribute('src', `${API}/media/staged_photos/101.jpg`)
    expect(uploads[0].contentType).toMatch(/^multipart\/form-data/)
    const sentFields = Object.fromEntries(appended())
    expect(sentFields).toMatchObject({ lat: '6.700000', lng: '-1.620000', accuracy_m: '9' })
    expect(sentFields.image).toBeInstanceOf(File)
    fireEvent.click(send)
    await waitFor(() => expect(body).not.toBeNull())
    expect(body).toEqual({
      listing: {
        name: 'Ankara wrap skirt', category: 2, zone: 3, description: 'Cotton wax print, made to order', price_amount: '180.00',
        stock_quantity: 4, has_warranty: false, warranty_details: '', has_expiry: false, expiry_date: null,
        return_policy: 'Exchange within 7 days if unworn',
      },
      main_photo_id: 101, photo_ids: [], reason: 'Owner showed me the new stock',
    })
    expect(await screen.findByText('Sent to Ama Boateng')).toBeInTheDocument()
  })

  it('needs a reason for the approver before it can be sent', async () => {
    serve()
    stagePhotos([])
    renderForm()
    await fillProduct()
    fireEvent.change(screen.getByLabelText('Why add it (Operations sees this)'), { target: { value: '   ' } })
    expect(screen.getByRole('button', { name: 'Send for approval' })).toBeDisabled()
    expect(screen.getByText('Say why — the approver sees it.')).toBeInTheDocument()
    // The preview's price is set in tabular figures (DESIGN.md).
    const preview = screen.getByRole('region', { name: 'How customers will see it' })
    expect(within(preview).getByText(/GH₵ 180\.00/).style.fontVariantNumeric).toBe('tabular-nums')
    fireEvent.change(screen.getByLabelText('Why add it (Operations sees this)'), { target: { value: 'New stock' } })
    expect(screen.getByRole('button', { name: 'Send for approval' })).toBeEnabled()
    expect(screen.queryByText('Say why — the approver sees it.')).not.toBeInTheDocument()
  })

  it('the default mock refuses a blank reason the way the server does', async () => {
    await expect(apiPost('/api/portfolio/businesses/12/listings/', { listing: {}, reason: ' ' }))
      .rejects.toMatchObject({ status: 400, body: { reason: ['Say why — the approver sees it.'] } })
    await expect(apiPost('/api/portfolio/businesses/12/listings/', { listing: {}, reason: 'New stock' }))
      .resolves.toMatchObject({ status: 'pending' })
  })

  it('asks a service business how long it takes instead of the product questions', async () => {
    serve(business({ business_kind: 'service' }))
    renderForm()
    expect(await screen.findByLabelText('How long it takes')).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Comes with a warranty?' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('In stock')).not.toBeInTheDocument()
  })

  it('says the product went live at once when a super admin proposed it', async () => {
    serve()
    stagePhotos([])
    server.use(http.post(`${API}/api/portfolio/businesses/12/listings/`, () => HttpResponse.json({ approval_id: 33, approver_name: null, status: 'approved' }, { status: 201 })))
    renderForm()
    await fillProduct()
    fireEvent.click(screen.getByRole('button', { name: 'Send for approval' }))
    expect(await screen.findByText('Applied — Adwoa can undo it for 7 days.')).toBeInTheDocument()
  })

  it("shows the server's refusal", async () => {
    serve()
    stagePhotos([])
    server.use(http.post(`${API}/api/portfolio/businesses/12/listings/`, () => HttpResponse.json({ detail: "Approve the business's KYC first." }, { status: 400 })))
    renderForm()
    await fillProduct()
    fireEvent.click(screen.getByRole('button', { name: 'Send for approval' }))
    expect(await screen.findByRole('alert')).toHaveTextContent("Approve the business's KYC first.")
  })

  it("names the lead as the moderator", async () => {
    serve()
    renderForm({ leadName: 'Ama Boateng' })
    expect(await screen.findByText(/Ama's approval is this listing's moderation\. It goes live when Ama Boateng approves it\./)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send to Ama Boateng' })).toBeInTheDocument()
  })
})
