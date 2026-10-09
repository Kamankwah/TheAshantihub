import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { server } from '../../../../mocks/server.js'
import RegisterBusinessPanel from '../RegisterBusinessPanel.jsx'

const API = 'http://localhost:8000'
const auth = { user: { id: 9, full_name: 'Kwame Asante', role: 'scout' }, hasPermission: () => true }
const PROSPECT = {
  id: 3, name: 'Asafo Hair & Beauty', phone: '+233201234761', zone: { id: 1, name: 'Manhyia' }, area: 'Manhyia', status: 'interested',
  status_label: 'Interested', note: '', next_follow_up_at: null, last_visit_at: null, has_pin: false,
}
const type = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } })

function serveProspects() {
  server.use(http.get(`${API}/api/field/prospects/`, () => HttpResponse.json({
    counts: { all: 1 }, signed_up_this_month: 0, results: [PROSPECT],
  })))
}

function renderPanel(props = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const onOpenDetail = vi.fn()
  render(<QueryClientProvider client={queryClient}><RegisterBusinessPanel auth={auth} detailId="prospect-3" onOpenDetail={onOpenDetail} {...props} /></QueryClientProvider>)
  return { onOpenDetail }
}

beforeEach(() => {
  localStorage.clear()
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: { getCurrentPosition: vi.fn((ok) => ok({ coords: { latitude: 6.6885, longitude: -1.6244, accuracy: 12 }, timestamp: Date.now() })) },
  })
})
afterEach(() => {
  delete navigator.geolocation
  vi.restoreAllMocks()
  localStorage.clear()
})

describe('Register a business from a prospect', () => {
  it('fills the first step in from the prospect and shows the "From prospect list" chip', async () => {
    serveProspects()
    renderPanel()
    expect(await screen.findByText('From prospect list')).toBeInTheDocument()
    expect(screen.getByLabelText('Business name (as on the signboard)')).toHaveValue('Asafo Hair & Beauty')
    expect(screen.getByLabelText("Owner's phone")).toHaveValue('+233201234761')
    // the owner's own name is never guessed from the business name
    expect(screen.getByLabelText("Owner's full name (as on Ghana Card)")).toHaveValue('')
    const draft = JSON.parse(localStorage.getItem('ashantihub.registerDraft.9'))
    expect(draft.form).toMatchObject({ prospect_id: '3', zone: '1' })
  })

  it('shows no chip for a plain registration', () => {
    renderPanel({ detailId: null })
    expect(screen.queryByText('From prospect list')).not.toBeInTheDocument()
  })

  it('asks before replacing a half-typed registration', async () => {
    localStorage.setItem('ashantihub.registerDraft.9', JSON.stringify({ v: 1, step: 0, saved_at: new Date().toISOString(), form: { business_name: 'Something else' } }))
    serveProspects()
    const { onOpenDetail } = renderPanel()
    expect(await screen.findByText('You have a registration in progress.')).toBeInTheDocument()
    expect(screen.getByLabelText('Business name (as on the signboard)')).toHaveValue('Something else')
    fireEvent.click(screen.getByRole('button', { name: 'Keep my draft' }))
    expect(onOpenDetail).toHaveBeenCalledWith(null)
    expect(screen.getByLabelText('Business name (as on the signboard)')).toHaveValue('Something else')
    expect(screen.queryByText('From prospect list')).not.toBeInTheDocument()
  })

  it('can start from the prospect instead of the draft', async () => {
    localStorage.setItem('ashantihub.registerDraft.9', JSON.stringify({ v: 1, step: 0, saved_at: new Date().toISOString(), form: { business_name: 'Something else' } }))
    serveProspects()
    renderPanel()
    fireEvent.click(await screen.findByRole('button', { name: 'Start from Asafo Hair & Beauty' }))
    expect(screen.getByLabelText('Business name (as on the signboard)')).toHaveValue('Asafo Hair & Beauty')
    expect(screen.getByText('From prospect list')).toBeInTheDocument()
  })

  it('lets the scout drop the link', async () => {
    serveProspects()
    renderPanel()
    await screen.findByText('From prospect list')
    fireEvent.click(screen.getByRole('button', { name: 'Not from the list' }))
    expect(screen.queryByText('From prospect list')).not.toBeInTheDocument()
  })

  it('sends prospect_id with the registration and returns to the plain wizard route', async () => {
    serveProspects()
    server.use(
      http.post(`${API}/api/portfolio/register/check/`, () => HttpResponse.json({ exact: [], similar: [], staff_match: false })),
      http.post(`${API}/api/portfolio/register/`, () => HttpResponse.json({ id: 41, business_name: 'Asafo Hair & Beauty', approver_name: 'Ama Boateng', flags: [], needs_claim: true }, { status: 201 })),
    )
    const { onOpenDetail } = renderPanel()
    await screen.findByText('From prospect list')
    type("Owner's full name (as on Ghana Card)", 'Gifty Asantewaa')
    type('Kind of business', 'service')
    await screen.findByRole('option', { name: 'Hotels' })
    type('Category', '1')
    fireEvent.click(screen.getByRole('button', { name: 'Next: Location' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Use my location' }))
    expect(await screen.findByText('Accuracy ±12 m')).toBeInTheDocument()
    await screen.findByRole('option', { name: 'Manhyia' })
    expect(screen.getByLabelText('Area')).toHaveValue('1') // from the prospect
    type('Ghana Post address', 'AK-112-0384')
    fireEvent.click(screen.getByRole('button', { name: 'Next: Photos' }))
    fireEvent.change(screen.getByLabelText('Signboard photo'), { target: { files: [new File(['s'], 's.jpg', { type: 'image/jpeg' })] } })
    fireEvent.change(screen.getByLabelText('Ghana Card front photo'), { target: { files: [new File(['c'], 'c.jpg', { type: 'image/jpeg' })] } })
    fireEvent.click(screen.getByRole('button', { name: 'Next: Review' }))
    await screen.findByText(/No exact match/)
    const append = vi.spyOn(FormData.prototype, 'append')
    fireEvent.click(screen.getByRole('button', { name: 'Submit for KYC' }))
    await screen.findByText('Sent to Ama Boateng for KYC')
    const sent = Object.fromEntries(append.mock.calls.map(([key, value]) => [key, value]))
    expect(sent).toMatchObject({ prospect_id: '3', business_name: 'Asafo Hair & Beauty', owner_phone: '+233201234761' })
    await waitFor(() => expect(onOpenDetail).toHaveBeenCalledWith(null))
  })

  it('drops a stale prospect from the draft when the server says it is gone, and says so', async () => {
    serveProspects()
    server.use(
      http.post(`${API}/api/portfolio/register/check/`, () => HttpResponse.json({ exact: [], similar: [], staff_match: false })),
      http.post(`${API}/api/portfolio/register/`, () => HttpResponse.json({ detail: 'That prospect is gone.', code: 'prospect' }, { status: 404 })),
    )
    renderPanel()
    await screen.findByText('From prospect list')
    type("Owner's full name (as on Ghana Card)", 'Gifty Asantewaa')
    type('Kind of business', 'service')
    await screen.findByRole('option', { name: 'Hotels' })
    type('Category', '1')
    fireEvent.click(screen.getByRole('button', { name: 'Next: Location' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Use my location' }))
    expect(await screen.findByText('Accuracy ±12 m')).toBeInTheDocument()
    type('Ghana Post address', 'AK-112-0384')
    fireEvent.click(screen.getByRole('button', { name: 'Next: Photos' }))
    fireEvent.change(screen.getByLabelText('Signboard photo'), { target: { files: [new File(['s'], 's.jpg', { type: 'image/jpeg' })] } })
    fireEvent.change(screen.getByLabelText('Ghana Card front photo'), { target: { files: [new File(['c'], 'c.jpg', { type: 'image/jpeg' })] } })
    fireEvent.click(screen.getByRole('button', { name: 'Next: Review' }))
    await screen.findByText(/No exact match/)
    fireEvent.click(screen.getByRole('button', { name: 'Submit for KYC' }))
    expect(await screen.findByText(/no longer on your list/)).toBeInTheDocument()
    await waitFor(() => expect(JSON.parse(localStorage.getItem('ashantihub.registerDraft.9')).form.prospect_id).toBe(''))
  })
})
