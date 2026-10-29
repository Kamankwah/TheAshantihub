import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { server } from '../../../../mocks/server.js'
import IdentityPanel from '../IdentityPanel.jsx'

const URL = 'http://localhost:8000/api/accounts/business-owners/me/identity/'
const BASE = { identity_status: 'not_submitted', identity_rejection_reason: '', identity_submitted_at: null, is_formal: false, has_certificate: false, has_tin: false }

// Reading a multipart body that holds a jsdom File hangs under this setup, so the POST handler only records the
// content type; the fields are read from FormData.prototype.append.
let append
beforeEach(() => { append = vi.spyOn(FormData.prototype, 'append') })
afterEach(() => append.mockRestore())

function serve(identity = {}) {
  server.use(http.get(URL, () => HttpResponse.json({ ...BASE, ...identity })))
}
function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}><IdentityPanel /></QueryClientProvider>)
}
const photo = (name) => new File(['x'], name, { type: 'image/jpeg' })
async function fillRequired() {
  fireEvent.change(await screen.findByLabelText('Ghana Card number'), { target: { value: 'GHA-123456789-0' } })
  fireEvent.change(screen.getByLabelText('Ghana Card photo, front'), { target: { files: [photo('front.jpg')] } })
  fireEvent.change(screen.getByLabelText('Ghana Card photo, back'), { target: { files: [photo('back.jpg')] } })
}
const submitBtn = () => screen.getByRole('button', { name: 'Submit for review' })

describe('IdentityPanel', () => {
  it('not submitted shows the form with the Ghana Card number and both photo inputs, certificate and TIN marked optional', async () => {
    serve()
    renderPanel()
    expect(await screen.findByText(/Upload your Ghana Card to earn the verified check mark on your products\. AshantiHub staff review it before the mark appears\./)).toBeInTheDocument()
    expect(screen.getByLabelText('Ghana Card number')).toBeInTheDocument()
    expect(screen.getByLabelText('Ghana Card photo, front')).toHaveAttribute('type', 'file')
    expect(screen.getByLabelText('Ghana Card photo, back')).toHaveAttribute('type', 'file')
    expect(screen.getByLabelText('Ghana Card photo, front')).toHaveAttribute('accept', expect.stringContaining('image/'))
    expect(screen.getByLabelText(/Registration certificate \(optional\)/)).toHaveAttribute('accept', expect.stringContaining('application/pdf'))
    expect(screen.getByLabelText(/TIN \(optional\)/)).toBeInTheDocument()
    expect(screen.getByLabelText('This business is registered')).not.toBeChecked()
  })

  it('prefills the registered tick from the account', async () => {
    serve({ is_formal: true })
    renderPanel()
    expect(await screen.findByLabelText('This business is registered')).toBeChecked()
  })

  it('submit is blocked until number and both photos are chosen', async () => {
    serve()
    renderPanel()
    fireEvent.change(await screen.findByLabelText('Ghana Card number'), { target: { value: 'GHA-123456789-0' } })
    expect(submitBtn()).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Ghana Card photo, front'), { target: { files: [photo('front.jpg')] } })
    expect(submitBtn()).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Ghana Card photo, back'), { target: { files: [photo('back.jpg')] } })
    expect(submitBtn()).toBeEnabled()
    fireEvent.change(screen.getByLabelText('Ghana Card number'), { target: { value: '  ' } })
    expect(submitBtn()).toBeDisabled()
  })

  it('pending shows "in review" and no form', async () => {
    serve({ identity_status: 'pending', identity_submitted_at: '2026-10-29T10:00:00Z' })
    renderPanel()
    expect(await screen.findByText(/In review/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Ghana Card number')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Submit for review' })).not.toBeInTheDocument()
  })

  it('rejected shows the reason and the form again', async () => {
    serve({ identity_status: 'rejected', identity_rejection_reason: 'The back of the card was blurred.' })
    renderPanel()
    expect(await screen.findByText(/The back of the card was blurred\./)).toBeInTheDocument()
    expect(screen.getByLabelText('Ghana Card number')).toBeInTheDocument()
    expect(submitBtn()).toBeInTheDocument()
  })

  it('verified shows the mark and no form', async () => {
    serve({ identity_status: 'verified' })
    renderPanel()
    expect(await screen.findByText('✓ Verified')).toBeInTheDocument()
    expect(screen.getByText(/mark shows on your products/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Ghana Card number')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Submit for review' })).not.toBeInTheDocument()
  })

  it('shows the API error', async () => {
    serve()
    server.use(http.post(URL, () => HttpResponse.json({ ghana_card_number: ['This card could not be used.'] }, { status: 400 })))
    renderPanel()
    await fillRequired()
    fireEvent.click(submitBtn())
    expect(await screen.findByRole('alert')).toHaveTextContent('This card could not be used.')
  })

  it('shows an honest line when the identity is already in review (409)', async () => {
    serve()
    server.use(http.post(URL, () => HttpResponse.json({ detail: 'Your identity is already in review.' }, { status: 409 })))
    renderPanel()
    await fillRequired()
    fireEvent.click(submitBtn())
    expect(await screen.findByRole('alert')).toHaveTextContent(/already in review/i)
  })

  it('never renders the card number back', async () => {
    serve({ identity_status: 'pending', ghana_card_number: 'GHA-123456789-0' })
    const { container } = renderPanel()
    await screen.findByText(/In review/)
    expect(container.textContent).not.toContain('GHA-123456789-0')
    expect(container.textContent).not.toContain('6789')
  })

  it('submit posts multipart with the right fields and refetches to the pending state', async () => {
    let status = 'not_submitted'
    let contentType = null
    server.use(
      http.get(URL, () => HttpResponse.json({ ...BASE, identity_status: status })),
      http.post(URL, ({ request }) => { contentType = request.headers.get('content-type'); status = 'pending'; return HttpResponse.json({ ...BASE, identity_status: 'pending' }, { status: 201 }) }),
    )
    renderPanel()
    await fillRequired()
    fireEvent.click(screen.getByLabelText('This business is registered'))
    fireEvent.click(submitBtn())
    expect(await screen.findByText(/In review/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Ghana Card number')).not.toBeInTheDocument()
    expect(contentType).toMatch(/multipart\/form-data/)
    const sent = Object.fromEntries(append.mock.calls.map(([k, v]) => [k, v]))
    expect(sent.ghana_card_number).toBe('GHA-123456789-0')
    expect(sent.ghana_card_front_image.name).toBe('front.jpg')
    expect(sent.ghana_card_back_image.name).toBe('back.jpg')
    expect(sent.is_formal).toBe('true')
  })

  it('certificate and TIN are omitted when not provided', async () => {
    let status = 'not_submitted'
    server.use(
      http.get(URL, () => HttpResponse.json({ ...BASE, identity_status: status })),
      http.post(URL, () => { status = 'pending'; return HttpResponse.json({ ...BASE, identity_status: 'pending' }, { status: 201 }) }),
    )
    renderPanel()
    await fillRequired()
    fireEvent.click(submitBtn())
    await screen.findByText(/In review/)
    const keys = append.mock.calls.map(([k]) => k)
    expect(keys).not.toContain('business_reg_certificate')
    expect(keys).not.toContain('tin')
    expect(append.mock.calls.find(([k]) => k === 'is_formal')[1]).toBe('false')
  })

  it('sends the certificate and TIN when given', async () => {
    let status = 'not_submitted'
    server.use(
      http.get(URL, () => HttpResponse.json({ ...BASE, identity_status: status })),
      http.post(URL, () => { status = 'pending'; return HttpResponse.json({ ...BASE, identity_status: 'pending' }, { status: 201 }) }),
    )
    renderPanel()
    await fillRequired()
    fireEvent.change(screen.getByLabelText(/Registration certificate/), { target: { files: [new File(['p'], 'cert.pdf', { type: 'application/pdf' })] } })
    fireEvent.change(screen.getByLabelText(/TIN/), { target: { value: 'C0012345678' } })
    fireEvent.click(submitBtn())
    await waitFor(() => expect(append.mock.calls.map(([k]) => k)).toContain('tin'))
    const sent = Object.fromEntries(append.mock.calls.map(([k, v]) => [k, v]))
    expect(sent.tin).toBe('C0012345678')
    expect(sent.business_reg_certificate.name).toBe('cert.pdf')
  })

  it('says plainly when the status cannot be loaded', async () => {
    server.use(http.get(URL, () => HttpResponse.json({ detail: 'no' }, { status: 500 })))
    renderPanel()
    expect(await screen.findByText(/Could not load your verification status/)).toBeInTheDocument()
  })
})
