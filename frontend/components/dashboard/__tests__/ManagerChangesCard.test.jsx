import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { server } from '../../../mocks/server.js'
import BusinessCommandCenter from '../BusinessCommandCenter.jsx'
import ManagerChangesCard from '../ManagerChangesCard.jsx'

const DAY = 86400000
const CHANGES_URL = 'http://localhost:8000/api/portfolio/owner/changes/'
const change = (overrides = {}) => ({
  id: 5, kind: 'listing.photos', summary: 'Added 4 photos to Adweneasa kente stole', made_by_name: 'Kwame Asante',
  applied_at: new Date(Date.now() - DAY).toISOString(), undo_until: new Date(Date.now() + 6 * DAY).toISOString(),
  can_undo: true, undone_at: null, undo_failed: '', ...overrides,
})

// GET serves the current rows; a successful undo marks the row undone, as the server does.
function serveChanges(initial) {
  let rows = initial
  const seen = { gets: 0, undone: [] }
  server.use(
    http.get(CHANGES_URL, () => { seen.gets += 1; return HttpResponse.json(rows) }),
    http.post(`${CHANGES_URL}:id/undo/`, ({ params }) => {
      seen.undone.push(params.id)
      rows = rows.map((r) => (String(r.id) === params.id ? { ...r, can_undo: false, undone_at: new Date().toISOString() } : r))
      return HttpResponse.json(rows.find((r) => String(r.id) === params.id))
    }),
  )
  return seen
}

function renderCard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}><ManagerChangesCard /></QueryClientProvider>)
}

describe('ManagerChangesCard', () => {
  it('renders nothing when the account manager changed nothing', async () => {
    const seen = serveChanges([])
    const { container } = renderCard()
    await waitFor(() => expect(seen.gets).toBe(1))
    expect(container).toBeEmptyDOMElement()
  })

  it('lists who changed what and when, with "This wasn\'t me" only while it can be undone', async () => {
    serveChanges([
      change(),
      change({ id: 6, summary: 'Changed the opening hours', can_undo: false, undo_until: new Date(Date.now() - DAY).toISOString(), applied_at: new Date(Date.now() - 8 * DAY).toISOString() }),
    ])
    renderCard()
    expect(await screen.findByRole('heading', { name: 'Changes by your account manager' })).toBeInTheDocument()
    expect(screen.getByText('Added 4 photos to Adweneasa kente stole')).toBeInTheDocument()
    expect(screen.getByText('Changed the opening hours')).toBeInTheDocument()
    expect(screen.getAllByText(/By Kwame Asante/)).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: "This wasn't me" })).toHaveLength(1)
    expect(screen.getByText(/The 7 days to undo this have passed — contact AshantiHub Support/)).toBeInTheDocument()
  })

  it('asks first, then posts the undo and shows the change as undone', async () => {
    const seen = serveChanges([change()])
    renderCard()
    fireEvent.click(await screen.findByRole('button', { name: "This wasn't me" }))
    expect(screen.getByText(/Undo “Added 4 photos to Adweneasa kente stole” and tell AshantiHub it wasn't you\?/)).toBeInTheDocument()
    // Undoing a sign-in change brings the earlier details back, so the owner is told before confirming.
    expect(screen.getByText('If this changed your sign-in phone or email, the earlier one comes back.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Yes, undo it' }))
    expect(await screen.findByText(/Undone on/)).toBeInTheDocument()
    expect(seen.undone).toEqual(['5'])
    expect(screen.queryByRole('button', { name: "This wasn't me" })).not.toBeInTheDocument()
  })

  it('"Keep it" cancels without undoing', async () => {
    const seen = serveChanges([change()])
    renderCard()
    fireEvent.click(await screen.findByRole('button', { name: "This wasn't me" }))
    fireEvent.click(screen.getByRole('button', { name: 'Keep it' }))
    expect(screen.getByRole('button', { name: "This wasn't me" })).toBeInTheDocument()
    expect(seen.undone).toEqual([])
  })

  it("shows the server's refusal", async () => {
    serveChanges([change()])
    server.use(http.post(`${CHANGES_URL}:id/undo/`, () => HttpResponse.json(
      { detail: 'The 7 days to undo this have passed — contact AshantiHub Support.' }, { status: 400 },
    )))
    renderCard()
    fireEvent.click(await screen.findByRole('button', { name: "This wasn't me" }))
    fireEvent.click(screen.getByRole('button', { name: 'Yes, undo it' }))
    expect(await screen.findByText('The 7 days to undo this have passed — contact AshantiHub Support.')).toBeInTheDocument()
  })

  it('says when only part of a change could be put back', async () => {
    serveChanges([change({ can_undo: false, undone_at: new Date().toISOString(), undo_failed: 'Some details changed again since — Operations will sort them out.' })])
    renderCard()
    expect(await screen.findByText(/Some details changed again since — Operations will sort them out\./)).toBeInTheDocument()
  })
})

describe('ManagerChangesCard on the dashboard', () => {
  function renderDashboard(kycStatus) {
    server.use(
      http.get('http://localhost:8000/api/accounts/business-owners/me/profile/', () => HttpResponse.json({ business_kind: 'product' })),
      http.get('http://localhost:8000/api/billing/subscriptions/me/', () => HttpResponse.json({})),
    )
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={queryClient}>
        <BusinessCommandCenter onExit={vi.fn()} auth={{ isLoading: false, logout: vi.fn() }}
          user={{ fullName: 'Abena', accountType: 'business_owner', kycStatus }} />
      </QueryClientProvider>,
    )
  }

  it('lets an owner whose KYC is still under review undo a change', async () => {
    serveChanges([change({ kind: 'business.update', summary: 'Changed sign-in phone' })])
    renderDashboard('pending')
    expect(screen.getByText(/under review/i)).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Changes by your account manager' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: "This wasn't me" })).toBeInTheDocument()
  })
})
