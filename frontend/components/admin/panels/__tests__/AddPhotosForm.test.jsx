import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { server } from '../../../../mocks/server.js'
import AddPhotosForm from '../AddPhotosForm.jsx'

const geo = vi.hoisted(() => ({ locate: vi.fn(), position: null }))
vi.mock('../../../../hooks/useDevicePosition.js', () => ({
  useDevicePosition: () => ({ position: geo.position, error: null, locating: false, locate: geo.locate }),
}))

const API = 'http://localhost:8000'
const LISTINGS = [
  { id: 40, name: 'Ankara wrap skirt', status: 'published', main_photo: null, photos_count: 2, price_amount: '180.00' },
  { id: 41, name: 'Batik fabric, 6 yards', status: 'published', main_photo: null, photos_count: 1, price_amount: '95.00' },
]
const business = (overrides = {}) => ({ id: 12, business_name: 'Adwoa Fabrics', owner_name: 'Adwoa Frimpong', zone: { id: 3, name: 'Bantama' }, listings: LISTINGS, can_manage: true, ...overrides })
let photoId = 100

function serve(b = business()) {
  server.use(http.get(`${API}/api/portfolio/businesses/12/`, () => HttpResponse.json(b)))
}
// Reading a multipart body that holds a jsdom File hangs under this test
// setup (see EventSubmissionPanel.test.jsx), so the handler only records the
// call; the fields are read from FormData.prototype.append.
function stagePhotos(uploads) {
  server.use(http.post(`${API}/api/portfolio/businesses/12/photos/`, ({ request }) => {
    uploads.push({ contentType: request.headers.get('content-type') })
    photoId += 1
    return HttpResponse.json({ id: photoId, url: `${API}/media/staged_photos/${photoId}.jpg`, created_at: '2026-10-08T10:00:00Z' }, { status: 201 })
  }))
}
const shot = () => new File(['jpeg-bytes'], 'shot.jpg', { type: 'image/jpeg' })
function renderForm() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <AddPhotosForm businessId="12" onBack={() => {}} onSent={() => {}} />
    </QueryClientProvider>,
  )
}

let append
beforeEach(() => { append = vi.spyOn(FormData.prototype, 'append'); photoId = 100; geo.position = null; geo.locate.mockClear() })
afterEach(() => append.mockRestore())

describe('AddPhotosForm', () => {
  it('adds photos to one listing and sends them for approval', async () => {
    let body = null
    serve()
    stagePhotos([])
    server.use(http.post(`${API}/api/portfolio/listings/41/photos/`, async ({ request }) => {
      body = await request.json()
      return HttpResponse.json({ approval_id: 34, approver_name: 'Ama Boateng' }, { status: 201 })
    }))
    renderForm()
    fireEvent.change(await screen.findByLabelText('Which listing'), { target: { value: '41' } })
    expect(screen.getByRole('button', { name: 'Send photos for approval' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/Take photo/), { target: { files: [shot()] } })
    await screen.findByRole('img', { name: 'Photo 1' })
    fireEvent.change(await screen.findByLabelText(/Take photo/), { target: { files: [shot()] } })
    await screen.findByRole('img', { name: 'Photo 2' })
    expect(screen.getByText('2 of up to 8')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Send 2 photos for approval' }))
    await waitFor(() => expect(body).toEqual({ photo_ids: [101, 102], reason: '' }))
    expect(await screen.findByText('Sent to Ama Boateng')).toBeInTheDocument()
  })

  it('uploads without a place when the phone shares no location', async () => {
    const uploads = []
    serve()
    stagePhotos(uploads)
    renderForm()
    fireEvent.change(await screen.findByLabelText(/Take photo/), { target: { files: [shot()] } })
    await screen.findByRole('img', { name: 'Photo 1' })
    expect(uploads[0].contentType).toMatch(/^multipart\/form-data/)
    const keys = append.mock.calls.map(([key]) => key)
    expect(keys).toContain('image')
    expect(keys).not.toContain('lat')
    expect(keys).not.toContain('accuracy_m')
  })

  it('removes a photo before sending', async () => {
    serve()
    stagePhotos([])
    renderForm()
    fireEvent.change(await screen.findByLabelText(/Take photo/), { target: { files: [shot()] } })
    await screen.findByRole('img', { name: 'Photo 1' })
    fireEvent.click(screen.getByRole('button', { name: 'Remove photo 1' }))
    expect(screen.queryByRole('img', { name: 'Photo 1' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send photos for approval' })).toBeDisabled()
  })

  it('says when the business has no listings yet', async () => {
    serve(business({ listings: [] }))
    renderForm()
    expect(await screen.findByText('This business has no listings yet — add a product first.')).toBeInTheDocument()
  })

  it("shows why a photo didn't upload", async () => {
    serve()
    server.use(http.post(`${API}/api/portfolio/businesses/12/photos/`, () => HttpResponse.json({ image: ['Upload a valid image.'] }, { status: 400 })))
    renderForm()
    fireEvent.change(await screen.findByLabelText(/Take photo/), { target: { files: [shot()] } })
    expect(await screen.findByRole('alert')).toHaveTextContent('Upload a valid image.')
  })
})
