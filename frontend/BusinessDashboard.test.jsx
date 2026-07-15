import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { BusinessDashboard } from './App.jsx'
import { server } from './mocks/server.js'

function renderWithQueryClient(ui) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

function mockDashboardData({ profile } = {}) {
  server.use(
    http.get('http://localhost:8000/api/listings/mine/', () => HttpResponse.json([])),
    http.get('http://localhost:8000/api/accounts/business-owners/me/profile/', () => HttpResponse.json(profile || {
      ghana_card_number: 'GHA-1', gps_address: 'AK-1', business_contact_phone: '+233200000000', is_formal: false,
    })),
    http.get('http://localhost:8000/api/billing/plans/', () => HttpResponse.json([])),
    http.get('http://localhost:8000/api/billing/subscriptions/me/', () => HttpResponse.json({})),
    http.get('http://localhost:8000/api/hero/mine/', () => HttpResponse.json({})),
  )
}

function makeAuth(overrides = {}) {
  return {
    submitBusinessInfo: vi.fn().mockResolvedValue({}),
    submitPayoutInfo: vi.fn().mockResolvedValue({}),
    acceptBusinessTerms: vi.fn().mockResolvedValue({}),
    refreshUser: vi.fn().mockResolvedValue({ registration_step: 'complete' }),
    logout: vi.fn(),
    ...overrides,
  }
}

describe('BusinessDashboard approval gating', () => {
  it('shows the normal tabs when verified', async () => {
    mockDashboardData()
    renderWithQueryClient(<BusinessDashboard onExit={vi.fn()} auth={makeAuth()} user={{ fullName: 'Abena', accountType: 'business_owner', kycStatus: 'verified' }} />)
    await waitFor(() => expect(screen.getByText(/Akwaaba, Abena/)).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /Listings & Prices/ })).not.toBeDisabled()
  })

  it('shows a pending-review status card with disabled tabs when pending', async () => {
    mockDashboardData()
    renderWithQueryClient(<BusinessDashboard onExit={vi.fn()} auth={makeAuth()} user={{ fullName: 'Abena', accountType: 'business_owner', kycStatus: 'pending' }} />)
    expect(screen.getByText(/under review/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Listings & Prices/ })).toBeDisabled()
    expect(screen.queryByText(/Akwaaba, Abena/)).not.toBeInTheDocument()
  })

  it('shows the rejection reason and a resubmit button when rejected', async () => {
    mockDashboardData()
    renderWithQueryClient(<BusinessDashboard onExit={vi.fn()} auth={makeAuth()} user={{ fullName: 'Abena', accountType: 'business_owner', kycStatus: 'rejected', kycRejectionReason: 'Blurry Ghana Card' }} />)
    expect(screen.getByText('Blurry Ghana Card')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Fix and Resubmit' })).toBeInTheDocument()
  })

  it('clicking Fix and Resubmit opens the registration flow pre-filled with the existing profile', async () => {
    mockDashboardData({ profile: { ghana_card_number: 'GHA-999', gps_address: 'AK-9', business_contact_phone: '+233209999999', is_formal: false } })
    renderWithQueryClient(<BusinessDashboard onExit={vi.fn()} auth={makeAuth()} user={{ fullName: 'Abena', accountType: 'business_owner', kycStatus: 'rejected', kycRejectionReason: 'Blurry Ghana Card' }} />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Fix and Resubmit' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Fix and Resubmit' }))
    await waitFor(() => expect(screen.getByPlaceholderText('Ghana Card number')).toHaveValue('GHA-999'))
  })
})

describe('BusinessDashboard Submit for Hero', () => {
  // GET /api/hero/mine/ is the source of truth for the status card
  // (docs/BUSINESS_EVENTS_ROADMAP.md Phase 2) — it's refetched after a
  // successful submit/extend, so these tests model that with a mutable
  // `currentSubmission` the GET handler reads and the POST handlers update,
  // mirroring how the real backend would behave across the refetch.
  function mockDashboardDataWithPhotos({ initialSubmission = {} } = {}) {
    let currentSubmission = initialSubmission
    server.use(
      http.get('http://localhost:8000/api/listings/mine/', () => HttpResponse.json([
        {
          id: 1, name: "Ama's Lodge", status: 'published', price_amount: '450.00', price_unit: 'per night',
          photos: [{ id: 11, image: 'http://localhost:8000/media/listing_photos/gallery/photo.jpg', order: 1 }],
        },
      ])),
      http.get('http://localhost:8000/api/accounts/business-owners/me/profile/', () => HttpResponse.json({
        ghana_card_number: 'GHA-1', gps_address: 'AK-1', business_contact_phone: '+233200000000', is_formal: false,
      })),
      http.get('http://localhost:8000/api/billing/plans/', () => HttpResponse.json([])),
      http.get('http://localhost:8000/api/billing/subscriptions/me/', () => HttpResponse.json({})),
      http.get('http://localhost:8000/api/hero/mine/', () => HttpResponse.json(currentSubmission)),
    )
    return {
      setSubmission: (next) => { currentSubmission = next },
    }
  }

  it('submits a gallery photo for hero consideration and shows the pending status', async () => {
    const { setSubmission } = mockDashboardDataWithPhotos()
    let submitBody = null
    server.use(
      http.post('http://localhost:8000/api/hero/submit/', async ({ request }) => {
        submitBody = await request.json()
        const created = { id: 21, status: 'pending', caption: submitBody.caption }
        setSubmission(created)
        return HttpResponse.json(created, { status: 201 })
      }),
    )
    renderWithQueryClient(<BusinessDashboard onExit={vi.fn()} auth={makeAuth()} user={{ fullName: 'Abena', accountType: 'business_owner', kycStatus: 'verified' }} />)
    fireEvent.click(await screen.findByRole('button', { name: /Listings & Prices/ }))
    fireEvent.click(await screen.findByText('🌟 Submit for Hero'))
    fireEvent.change(screen.getByPlaceholderText('A one-sentence caption for the hero slider…'), { target: { value: 'Best lodge in town' } })
    fireEvent.click(screen.getByText('✓ Submit for Hero'))
    await waitFor(() => expect(submitBody).toEqual({ listing_photo: 11, caption: 'Best lodge in town' }))
    await screen.findByText(/Hero Spotlight/)
    expect(screen.getByText('Pending Review')).toBeInTheDocument()
  })

  it('shows an inline error when the submission fails', async () => {
    mockDashboardDataWithPhotos()
    server.use(
      http.post('http://localhost:8000/api/hero/submit/', () => HttpResponse.json({ detail: 'Already outstanding' }, { status: 400 })),
    )
    renderWithQueryClient(<BusinessDashboard onExit={vi.fn()} auth={makeAuth()} user={{ fullName: 'Abena', accountType: 'business_owner', kycStatus: 'verified' }} />)
    fireEvent.click(await screen.findByRole('button', { name: /Listings & Prices/ }))
    fireEvent.click(await screen.findByText('🌟 Submit for Hero'))
    fireEvent.change(screen.getByPlaceholderText('A one-sentence caption for the hero slider…'), { target: { value: 'Best lodge in town' } })
    fireEvent.click(screen.getByText('✓ Submit for Hero'))
    await screen.findByText('Could not submit this photo for Hero — you may already have a pending or active submission.')
  })

  it('shows the existing submission status after a page reload, sourced from GET /api/hero/mine/', async () => {
    mockDashboardDataWithPhotos({
      initialSubmission: { id: 30, status: 'rejected', caption: 'Old caption', rejection_reason: 'Blurry photo' },
    })
    renderWithQueryClient(<BusinessDashboard onExit={vi.fn()} auth={makeAuth()} user={{ fullName: 'Abena', accountType: 'business_owner', kycStatus: 'verified' }} />)
    fireEvent.click(await screen.findByRole('button', { name: /Listings & Prices/ }))
    await screen.findByText(/Hero Spotlight/)
    expect(screen.getByText('Rejected')).toBeInTheDocument()
    expect(screen.getByText('Rejected: Blurry photo')).toBeInTheDocument()
  })

  it('shows an Extend action once the submission is approved, opening the reused MoMo payment flow', async () => {
    const { setSubmission } = mockDashboardDataWithPhotos()
    server.use(
      http.post('http://localhost:8000/api/hero/submit/', () => {
        const created = { id: 21, status: 'approved', caption: 'Best lodge in town', expires_at: '2026-08-01T00:00:00Z' }
        setSubmission(created)
        return HttpResponse.json(created, { status: 201 })
      }),
    )
    renderWithQueryClient(<BusinessDashboard onExit={vi.fn()} auth={makeAuth()} user={{ fullName: 'Abena', accountType: 'business_owner', kycStatus: 'verified' }} />)
    fireEvent.click(await screen.findByRole('button', { name: /Listings & Prices/ }))
    fireEvent.click(await screen.findByText('🌟 Submit for Hero'))
    fireEvent.change(screen.getByPlaceholderText('A one-sentence caption for the hero slider…'), { target: { value: 'Best lodge in town' } })
    fireEvent.click(screen.getByText('✓ Submit for Hero'))
    const extendButton = await screen.findByText('💰 Extend 7d')
    fireEvent.click(extendButton)
    // Reuses MoMoModal/MoMoPayment's existing simulated-payment UI
    // (docs/BUSINESS_EVENTS_ROADMAP.md Phase 2) rather than inventing new
    // payment UI — assert the reused component actually opened.
    expect(screen.getByText('💰 Mobile Money Payment')).toBeInTheDocument()
    expect(screen.getByText(/Extend Hero Spotlight — 7 days/)).toBeInTheDocument()
    expect(screen.getByText('MTN MoMo')).toBeInTheDocument()
  })

  it('extends the submission after completing the simulated MoMo payment', async () => {
    const { setSubmission } = mockDashboardDataWithPhotos()
    server.use(
      http.post('http://localhost:8000/api/hero/submit/', () => {
        const created = { id: 21, status: 'approved', caption: 'Best lodge in town', expires_at: '2026-08-01T00:00:00Z' }
        setSubmission(created)
        return HttpResponse.json(created, { status: 201 })
      }),
    )
    let extendBody = null
    server.use(
      http.post('http://localhost:8000/api/hero/21/extend/', async ({ request }) => {
        extendBody = await request.json()
        const updated = { id: 21, status: 'approved', caption: 'Best lodge in town', extended_days: 7, expires_at: '2026-08-08T00:00:00Z' }
        setSubmission(updated)
        return HttpResponse.json(updated)
      }),
    )
    renderWithQueryClient(<BusinessDashboard onExit={vi.fn()} auth={makeAuth()} user={{ fullName: 'Abena', accountType: 'business_owner', kycStatus: 'verified' }} />)
    fireEvent.click(await screen.findByRole('button', { name: /Listings & Prices/ }))
    fireEvent.click(await screen.findByText('🌟 Submit for Hero'))
    fireEvent.change(screen.getByPlaceholderText('A one-sentence caption for the hero slider…'), { target: { value: 'Best lodge in town' } })
    fireEvent.click(screen.getByText('✓ Submit for Hero'))
    fireEvent.click(await screen.findByText('💰 Extend 7d'))
    fireEvent.click(screen.getByText('MTN MoMo'))
    fireEvent.change(screen.getByPlaceholderText('0244 000 000'), { target: { value: '0244000000' } })

    // MoMoPayment's step-3 "processing" countdown runs on a real 100ms
    // setInterval down from 30, then an extra 1s timeout before onSuccess
    // fires — faking timers here keeps this deterministic instead of
    // depending on wall-clock time under a potentially busy test runner.
    vi.useFakeTimers({ shouldAdvanceTime: true })
    fireEvent.click(screen.getByText(/Pay GHS/))
    await vi.advanceTimersByTimeAsync(4100)
    vi.useRealTimers()

    await waitFor(() => expect(extendBody).toEqual({ days: 7 }))
    await screen.findByText(/Live until 2026-08-08/)
  })
})

describe('BusinessDashboard Promote this listing', () => {
  // POST /api/listings/{id}/promote/ both creates and applies the
  // promotion in one call (docs/BUSINESS_EVENTS_ROADMAP.md Phase 5) — unlike
  // Hero Spotlight's extend flow, there's no separate "confirm after
  // payment" write, so these tests just assert the POST body, that the
  // returned amount_paid opens the reused MoMo payment flow, and that a
  // successful payment refetches the owner's listings.
  function mockDashboardDataWithPublishedListing() {
    server.use(
      http.get('http://localhost:8000/api/listings/mine/', () => HttpResponse.json([
        {
          id: 1, name: "Ama's Lodge", status: 'published', price_amount: '450.00', price_unit: 'per night',
          photos: [],
        },
      ])),
      http.get('http://localhost:8000/api/accounts/business-owners/me/profile/', () => HttpResponse.json({
        ghana_card_number: 'GHA-1', gps_address: 'AK-1', business_contact_phone: '+233200000000', is_formal: false,
      })),
      http.get('http://localhost:8000/api/billing/plans/', () => HttpResponse.json([])),
      http.get('http://localhost:8000/api/billing/subscriptions/me/', () => HttpResponse.json({})),
      http.get('http://localhost:8000/api/hero/mine/', () => HttpResponse.json({})),
    )
  }

  it('only shows the Promote action for a published listing', async () => {
    mockDashboardDataWithPublishedListing()
    renderWithQueryClient(<BusinessDashboard onExit={vi.fn()} auth={makeAuth()} user={{ fullName: 'Abena', accountType: 'business_owner', kycStatus: 'verified' }} />)
    fireEvent.click(await screen.findByRole('button', { name: /Listings & Prices/ }))
    await screen.findByText("Ama's Lodge")
    expect(screen.getByText('📣 Promote')).toBeInTheDocument()
  })

  it('purchases a Featured promotion and opens the reused MoMo payment flow with the returned amount', async () => {
    mockDashboardDataWithPublishedListing()
    let promoteBody = null
    server.use(
      http.post('http://localhost:8000/api/listings/1/promote/', async ({ request }) => {
        promoteBody = await request.json()
        return HttpResponse.json({
          id: 9, listing: 1, kind: 'featured', starts_at: '2026-07-14T00:00:00Z', ends_at: '2026-07-21T00:00:00Z',
          keywords: '', amount_paid: '35.00', status: 'active',
        }, { status: 201 })
      }),
    )
    renderWithQueryClient(<BusinessDashboard onExit={vi.fn()} auth={makeAuth()} user={{ fullName: 'Abena', accountType: 'business_owner', kycStatus: 'verified' }} />)
    fireEvent.click(await screen.findByRole('button', { name: /Listings & Prices/ }))
    fireEvent.click(await screen.findByText('📣 Promote'))
    fireEvent.click(screen.getByText('📣 Promote 7d'))
    await waitFor(() => expect(promoteBody).toEqual({ kind: 'featured', days: 7 }))
    expect(screen.getByText('💰 Mobile Money Payment')).toBeInTheDocument()
    expect(screen.getByText('GHS 35.00')).toBeInTheDocument()
  })

  it('requires keywords for a Boost promotion and sends them in the request', async () => {
    mockDashboardDataWithPublishedListing()
    let promoteBody = null
    server.use(
      http.post('http://localhost:8000/api/listings/1/promote/', async ({ request }) => {
        promoteBody = await request.json()
        return HttpResponse.json({
          id: 10, listing: 1, kind: 'boost', starts_at: '2026-07-14T00:00:00Z', ends_at: '2026-07-21T00:00:00Z',
          keywords: 'jollof, catering', amount_paid: '21.00', status: 'active',
        }, { status: 201 })
      }),
    )
    renderWithQueryClient(<BusinessDashboard onExit={vi.fn()} auth={makeAuth()} user={{ fullName: 'Abena', accountType: 'business_owner', kycStatus: 'verified' }} />)
    fireEvent.click(await screen.findByRole('button', { name: /Listings & Prices/ }))
    fireEvent.click(await screen.findByText('📣 Promote'))
    fireEvent.change(screen.getByDisplayValue('Featured'), { target: { value: 'boost' } })
    const promoteButton = screen.getByText('📣 Promote 7d')
    expect(promoteButton).toBeDisabled()
    fireEvent.change(screen.getByPlaceholderText('e.g. jollof, catering'), { target: { value: 'jollof, catering' } })
    expect(promoteButton).not.toBeDisabled()
    fireEvent.click(promoteButton)
    await waitFor(() => expect(promoteBody).toEqual({ kind: 'boost', days: 7, keywords: 'jollof, catering' }))
    expect(screen.getByText('💰 Mobile Money Payment')).toBeInTheDocument()
  })

  it('shows an inline error when the purchase fails', async () => {
    mockDashboardDataWithPublishedListing()
    server.use(
      http.post('http://localhost:8000/api/listings/1/promote/', () => HttpResponse.json({ detail: 'Already active' }, { status: 400 })),
    )
    renderWithQueryClient(<BusinessDashboard onExit={vi.fn()} auth={makeAuth()} user={{ fullName: 'Abena', accountType: 'business_owner', kycStatus: 'verified' }} />)
    fireEvent.click(await screen.findByRole('button', { name: /Listings & Prices/ }))
    fireEvent.click(await screen.findByText('📣 Promote'))
    fireEvent.click(screen.getByText('📣 Promote 7d'))
    await screen.findByText('Could not create this promotion — it may already be active on this listing, or the listing isn\'t published yet.')
  })

  it('refetches listings and shows a confirmation toast after completing the simulated MoMo payment', async () => {
    mockDashboardDataWithPublishedListing()
    server.use(
      http.post('http://localhost:8000/api/listings/1/promote/', () => HttpResponse.json({
        id: 9, listing: 1, kind: 'featured', starts_at: '2026-07-14T00:00:00Z', ends_at: '2026-07-21T00:00:00Z',
        keywords: '', amount_paid: '35.00', status: 'active',
      }, { status: 201 })),
    )
    let refetchCount = 0
    server.use(
      http.get('http://localhost:8000/api/listings/mine/', () => {
        refetchCount += 1
        return HttpResponse.json([
          { id: 1, name: "Ama's Lodge", status: 'published', price_amount: '450.00', price_unit: 'per night', photos: [] },
        ])
      }),
    )
    renderWithQueryClient(<BusinessDashboard onExit={vi.fn()} auth={makeAuth()} user={{ fullName: 'Abena', accountType: 'business_owner', kycStatus: 'verified' }} />)
    fireEvent.click(await screen.findByRole('button', { name: /Listings & Prices/ }))
    fireEvent.click(await screen.findByText('📣 Promote'))
    fireEvent.click(screen.getByText('📣 Promote 7d'))
    await screen.findByText('💰 Mobile Money Payment')
    fireEvent.click(screen.getByText('MTN MoMo'))
    fireEvent.change(screen.getByPlaceholderText('0244 000 000'), { target: { value: '0244000000' } })

    const initialRefetchCount = refetchCount
    vi.useFakeTimers({ shouldAdvanceTime: true })
    fireEvent.click(screen.getByText(/Pay GHS/))
    await vi.advanceTimersByTimeAsync(4100)
    vi.useRealTimers()

    await waitFor(() => expect(refetchCount).toBeGreaterThan(initialRefetchCount))
    await screen.findByText('✓ Saved!')
  })
})

describe('BusinessDashboard Listings & Prices specs/service_duration editing', () => {
  // canEdit is item.status !== "published", so these tests use a draft
  // listing to reach the edit form.
  function mockDashboardDataWithDraftListing({ specs = [], service_duration = '' } = {}) {
    server.use(
      http.get('http://localhost:8000/api/listings/mine/', () => HttpResponse.json([
        {
          id: 1, name: "Ama's Lodge", status: 'draft', price_amount: '450.00', price_unit: 'per night',
          specs, service_duration, photos: [],
        },
      ])),
      http.get('http://localhost:8000/api/accounts/business-owners/me/profile/', () => HttpResponse.json({
        ghana_card_number: 'GHA-1', gps_address: 'AK-1', business_contact_phone: '+233200000000', is_formal: false,
      })),
      http.get('http://localhost:8000/api/billing/plans/', () => HttpResponse.json([])),
      http.get('http://localhost:8000/api/billing/subscriptions/me/', () => HttpResponse.json({})),
      http.get('http://localhost:8000/api/hero/mine/', () => HttpResponse.json({})),
    )
  }

  it('seeds the edit form with the listing\'s existing specs and service_duration', async () => {
    mockDashboardDataWithDraftListing({
      specs: [{ label: 'Material', value: 'Cotton' }],
      service_duration: '2 hours',
    })
    renderWithQueryClient(<BusinessDashboard onExit={vi.fn()} auth={makeAuth()} user={{ fullName: 'Abena', accountType: 'business_owner', kycStatus: 'verified' }} />)
    fireEvent.click(await screen.findByRole('button', { name: /Listings & Prices/ }))
    fireEvent.click(await screen.findByText('✏️ Edit'))
    expect(screen.getByDisplayValue('2 hours')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Material')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Cotton')).toBeInTheDocument()
  })

  it('adds a spec row, fills service_duration, and saves with the PATCH body including both', async () => {
    mockDashboardDataWithDraftListing()
    let patchBody = null
    server.use(
      http.patch('http://localhost:8000/api/listings/mine/1/', async ({ request }) => {
        patchBody = await request.json()
        return HttpResponse.json({ id: 1 })
      }),
    )
    renderWithQueryClient(<BusinessDashboard onExit={vi.fn()} auth={makeAuth()} user={{ fullName: 'Abena', accountType: 'business_owner', kycStatus: 'verified' }} />)
    fireEvent.click(await screen.findByRole('button', { name: /Listings & Prices/ }))
    fireEvent.click(await screen.findByText('✏️ Edit'))
    fireEvent.change(screen.getByPlaceholderText('e.g. 2 hours'), { target: { value: '3 hours' } })
    fireEvent.click(screen.getByText('+ Add spec'))
    fireEvent.change(screen.getByPlaceholderText('Label (e.g. Material)'), { target: { value: 'Color' } })
    fireEvent.change(screen.getByPlaceholderText('Value (e.g. Cotton)'), { target: { value: 'Kente Gold' } })
    fireEvent.click(screen.getByText('✓ Save'))
    await waitFor(() => expect(patchBody).toMatchObject({
      name: "Ama's Lodge",
      service_duration: '3 hours',
      specs: [{ label: 'Color', value: 'Kente Gold' }],
    }))
  })

  it('removes a spec row via the ✕ button', async () => {
    mockDashboardDataWithDraftListing({ specs: [{ label: 'Material', value: 'Cotton' }] })
    let patchBody = null
    server.use(
      http.patch('http://localhost:8000/api/listings/mine/1/', async ({ request }) => {
        patchBody = await request.json()
        return HttpResponse.json({ id: 1 })
      }),
    )
    renderWithQueryClient(<BusinessDashboard onExit={vi.fn()} auth={makeAuth()} user={{ fullName: 'Abena', accountType: 'business_owner', kycStatus: 'verified' }} />)
    fireEvent.click(await screen.findByRole('button', { name: /Listings & Prices/ }))
    fireEvent.click(await screen.findByText('✏️ Edit'))
    expect(screen.getByDisplayValue('Material')).toBeInTheDocument()
    fireEvent.click(screen.getByText('✕'))
    expect(screen.queryByDisplayValue('Material')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('✓ Save'))
    await waitFor(() => expect(patchBody).toMatchObject({ specs: [] }))
  })
})
