import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { BusinessDashboard } from './App.jsx'
import BusinessCommandCenter from './components/dashboard/BusinessCommandCenter.jsx'
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

describe('BusinessDashboard Listings & Prices — create a new listing', () => {
  // The create form (comprehensive listing-creation work) branches on the
  // selected category's kind — the default mock categories handler serves
  // Hotels (service, id 1) and Food (product, id 2).
  function openCreateForm() {
    return (async () => {
      fireEvent.click(await screen.findByRole('button', { name: /Listings & Prices/ }))
      fireEvent.click(await screen.findByText('➕ List a New Product / Service'))
      await screen.findByText('➕ New Listing')
    })()
  }

  function fillCommonFields({ categoryId }) {
    fireEvent.change(screen.getByDisplayValue('Choose a category…'), { target: { value: String(categoryId) } })
    fireEvent.change(screen.getByDisplayValue('Choose a zone…'), { target: { value: '1' } })
    fireEvent.change(screen.getByPlaceholderText('e.g. Hand-woven Kente Scarf'), { target: { value: 'Kente Scarf' } })
    fireEvent.change(screen.getByPlaceholderText("Describe what you're offering — customers see this on your listing page"), { target: { value: 'Hand-woven.' } })
  }

  it('keeps Create disabled for a product until warranty/expiry/return-policy are consciously answered', async () => {
    mockDashboardData()
    renderWithQueryClient(<BusinessDashboard onExit={vi.fn()} auth={makeAuth()} user={{ fullName: 'Abena', accountType: 'business_owner', kycStatus: 'verified' }} />)
    await openCreateForm()
    fillCommonFields({ categoryId: 2 })
    // Product decision fields revealed, but unanswered → still disabled
    expect(screen.getByText('Return policy *')).toBeInTheDocument()
    expect(screen.getByText('✓ Create Listing')).toBeDisabled()
    const [warrantySelect, expirySelect] = screen.getAllByDisplayValue('— Please answer —')
    fireEvent.change(warrantySelect, { target: { value: 'no' } })
    fireEvent.change(expirySelect, { target: { value: 'no' } })
    expect(screen.getByText('✓ Create Listing')).toBeDisabled()
    fireEvent.change(screen.getByPlaceholderText('e.g. Returns accepted within 7 days if unused, buyer covers transport'), { target: { value: '7-day returns.' } })
    expect(screen.getByText('✓ Create Listing')).not.toBeDisabled()
  })

  it('creates a product listing with the decision fields in the POST body and shows the toast', async () => {
    mockDashboardData()
    let postBody = null
    server.use(
      http.post('http://localhost:8000/api/listings/mine/', async ({ request }) => {
        postBody = await request.json()
        return HttpResponse.json({ id: 42, ...postBody, status: 'draft' }, { status: 201 })
      }),
    )
    renderWithQueryClient(<BusinessDashboard onExit={vi.fn()} auth={makeAuth()} user={{ fullName: 'Abena', accountType: 'business_owner', kycStatus: 'verified' }} />)
    await openCreateForm()
    fillCommonFields({ categoryId: 2 })
    const [warrantySelect, expirySelect] = screen.getAllByDisplayValue('— Please answer —')
    fireEvent.change(warrantySelect, { target: { value: 'yes' } })
    fireEvent.change(expirySelect, { target: { value: 'no' } })
    fireEvent.change(screen.getByPlaceholderText('e.g. 12-month manufacturer warranty covering defects'), { target: { value: '12-month warranty.' } })
    fireEvent.change(screen.getByPlaceholderText('e.g. Returns accepted within 7 days if unused, buyer covers transport'), { target: { value: '7-day returns.' } })
    fireEvent.change(screen.getByPlaceholderText('e.g. Bonwire Weavers'), { target: { value: 'Bonwire Weavers' } })
    fireEvent.change(screen.getByDisplayValue('Not specified'), { target: { value: 'new' } })
    fireEvent.change(screen.getByPlaceholderText('Leave blank if not tracked'), { target: { value: '5' } })
    fireEvent.click(screen.getByText('✓ Create Listing'))
    await waitFor(() => expect(postBody).toMatchObject({
      category: 2, zone: 1, name: 'Kente Scarf', description: 'Hand-woven.',
      has_warranty: true, warranty_details: '12-month warranty.',
      has_expiry: false, expiry_date: null, return_policy: '7-day returns.',
      brand: 'Bonwire Weavers', condition: 'new', stock_quantity: 5,
    }))
    await screen.findByText('✓ Saved!')
  })

  it('reveals the Fiverr-style service fields (and no product battery) for a service category', async () => {
    mockDashboardData()
    let postBody = null
    server.use(
      http.post('http://localhost:8000/api/listings/mine/', async ({ request }) => {
        postBody = await request.json()
        return HttpResponse.json({ id: 43, ...postBody, status: 'draft' }, { status: 201 })
      }),
    )
    renderWithQueryClient(<BusinessDashboard onExit={vi.fn()} auth={makeAuth()} user={{ fullName: 'Abena', accountType: 'business_owner', kycStatus: 'verified' }} />)
    await openCreateForm()
    fillCommonFields({ categoryId: 1 })
    expect(screen.queryByText('Return policy *')).not.toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText('What the customer gets — e.g. transport, materials, consultation'), { target: { value: 'Transport and guide.' } })
    fireEvent.change(screen.getByPlaceholderText('What you need from the customer before you can start'), { target: { value: 'Comfortable shoes.' } })
    fireEvent.change(screen.getByPlaceholderText('e.g. 2 hours'), { target: { value: '3 hours' } })
    fireEvent.change(screen.getByPlaceholderText('e.g. 3-5 business days'), { target: { value: 'Within 48 hours' } })
    // No product answers needed for a service — button enabled already
    expect(screen.getByText('✓ Create Listing')).not.toBeDisabled()
    fireEvent.click(screen.getByText('✓ Create Listing'))
    await waitFor(() => expect(postBody).toMatchObject({
      category: 1, zone: 1, name: 'Kente Scarf',
      service_duration: '3 hours', whats_included: 'Transport and guide.',
      requirements: 'Comfortable shoes.', delivery_time: 'Within 48 hours',
    }))
  })

  it('surfaces the server field error when the create is rejected', async () => {
    mockDashboardData()
    server.use(
      http.post('http://localhost:8000/api/listings/mine/', () => HttpResponse.json(
        { subscription: ["Your subscription isn't active. Choose or renew a plan before adding new listings."] },
        { status: 400 },
      )),
    )
    renderWithQueryClient(<BusinessDashboard onExit={vi.fn()} auth={makeAuth()} user={{ fullName: 'Abena', accountType: 'business_owner', kycStatus: 'verified' }} />)
    await openCreateForm()
    fillCommonFields({ categoryId: 1 })
    fireEvent.click(screen.getByText('✓ Create Listing'))
    await screen.findByText(/subscription: Your subscription isn't active/)
  })
})

describe('BusinessDashboard Listings & Prices — business-kind create gating', () => {
  // The default categories handler serves Hotels (service, id 1) and Food
  // (product, id 2). A product/service business_kind on the profile should lock
  // the create button label + category dropdown to that kind.
  it('locks the create form to products for a product business', async () => {
    mockDashboardData({ profile: {
      ghana_card_number: 'GHA-1', gps_address: 'AK-1', business_contact_phone: '+233200000000',
      is_formal: false, business_kind: 'product',
    } })
    renderWithQueryClient(<BusinessDashboard onExit={vi.fn()} auth={makeAuth()} user={{ fullName: 'Abena', accountType: 'business_owner', kycStatus: 'verified' }} />)
    fireEvent.click(await screen.findByRole('button', { name: /Listings & Prices/ }))
    const createBtn = await screen.findByText('➕ List a New Product')
    fireEvent.click(createBtn)
    await screen.findByText('➕ New Listing')
    expect(screen.getByText('🍲 Food (product)')).toBeInTheDocument()
    expect(screen.queryByText('🏨 Hotels (service)')).not.toBeInTheDocument()
  })

  it('locks the create form to services for a service business', async () => {
    mockDashboardData({ profile: {
      ghana_card_number: 'GHA-1', gps_address: 'AK-1', business_contact_phone: '+233200000000',
      is_formal: false, business_kind: 'service',
    } })
    renderWithQueryClient(<BusinessDashboard onExit={vi.fn()} auth={makeAuth()} user={{ fullName: 'Abena', accountType: 'business_owner', kycStatus: 'verified' }} />)
    fireEvent.click(await screen.findByRole('button', { name: /Listings & Prices/ }))
    const createBtn = await screen.findByText('➕ List a New Service')
    fireEvent.click(createBtn)
    await screen.findByText('➕ New Listing')
    expect(screen.getByText('🏨 Hotels (service)')).toBeInTheDocument()
    expect(screen.queryByText('🍲 Food (product)')).not.toBeInTheDocument()
  })

  it('falls back to offering both kinds when business_kind is null', async () => {
    mockDashboardData({ profile: {
      ghana_card_number: 'GHA-1', gps_address: 'AK-1', business_contact_phone: '+233200000000',
      is_formal: false, business_kind: null,
    } })
    renderWithQueryClient(<BusinessDashboard onExit={vi.fn()} auth={makeAuth()} user={{ fullName: 'Abena', accountType: 'business_owner', kycStatus: 'verified' }} />)
    fireEvent.click(await screen.findByRole('button', { name: /Listings & Prices/ }))
    fireEvent.click(await screen.findByText('➕ List a New Product / Service'))
    await screen.findByText('➕ New Listing')
    expect(screen.getByText('🍲 Food (product)')).toBeInTheDocument()
    expect(screen.getByText('🏨 Hotels (service)')).toBeInTheDocument()
  })
})

// ─── Command Center — new dark analytics / unified dashboard ─────────────────
// Rich analytics fixture: listings across statuses, a spend transaction, a real
// credit score with factors, and an active subscription with plan entitlements.
function mockAnalyticsData() {
  server.use(
    http.get('http://localhost:8000/api/listings/mine/', () => HttpResponse.json([
      { id: 1, name: 'Ama Lodge', status: 'published', price_amount: '450.00', price_unit: 'per night', photos: [] },
      { id: 2, name: 'Kente Store', status: 'published', price_amount: '90.00', price_unit: 'per item', photos: [] },
      { id: 3, name: 'Draft Tour', status: 'pending_review', price_amount: '60.00', price_unit: 'per person', photos: [] },
      { id: 4, name: 'Old Draft', status: 'draft', price_amount: null, price_unit: 'per item', photos: [] },
    ])),
    http.get('http://localhost:8000/api/accounts/business-owners/me/profile/', () => HttpResponse.json({
      ghana_card_number: 'GHA-1', gps_address: 'Adum, Kumasi', business_contact_phone: '+233200000000', is_formal: true,
    })),
    http.get('http://localhost:8000/api/billing/plans/', () => HttpResponse.json([])),
    http.get('http://localhost:8000/api/billing/subscriptions/me/', () => HttpResponse.json({
      id: 5, plan: { name: 'Growth', tier: 'growth', max_active_listings: 10, hero_days: 14, boost_credits_per_month: 5 },
      billing_cycle: 'monthly', status: 'active', current_period_end: '2099-01-01T00:00:00Z',
    })),
    http.get('http://localhost:8000/api/hero/mine/', () => HttpResponse.json({})),
    http.get('http://localhost:8000/api/billing/transactions/mine/', () => HttpResponse.json([
      { id: 1, amount: '120.00', purpose: 'AshantiHub Growth Plan — Monthly', status: 'success', reference: 'R1', created_at: '2026-07-05T00:00:00Z' },
    ])),
    http.get('http://localhost:8000/api/credit/scores/me/', () => HttpResponse.json({
      score: 720, grade: 'B+', grade_label: 'Good', loan_eligible: true,
      factors: { listings_published: { value: 4, score_pct: 40, weight: 0.3 }, kyc_verified: { value: true, score_pct: 100, weight: 0.2 } },
      computed_at: '2026-07-01T00:00:00Z',
    })),
    http.get('http://localhost:8000/api/reviews/seller/:id/', () => HttpResponse.json({
      count: 12, next: null, previous: null, results: [], avg_rating: 4.6, review_count: 12,
    })),
  )
}

const analyticsUser = { id: 7, fullName: 'Abena Owusu', accountType: 'business_owner', kycStatus: 'verified' }

describe('BusinessDashboard Analytics tab', () => {
  it('renders the KPI row from real derived data', async () => {
    mockAnalyticsData()
    renderWithQueryClient(<BusinessDashboard onExit={vi.fn()} auth={makeAuth()} user={analyticsUser} />)
    await waitFor(() => expect(screen.getByText(/Akwaaba, Abena/)).toBeInTheDocument())
    // KPI labels
    expect(screen.getByText('Active Listings')).toBeInTheDocument()
    expect(screen.getByText('Business Rating')).toBeInTheDocument()
    expect(screen.getByText('Credit Score')).toBeInTheDocument()
    // KPI values: 2 published listings, 4.6★ rating, Growth plan
    await waitFor(() => expect(screen.getByText('4.6★')).toBeInTheDocument())
    expect(screen.getByText('Growth')).toBeInTheDocument()
    // Credit score 720 appears (KPI + gauge overlay)
    expect(screen.getAllByText('720').length).toBeGreaterThan(0)
  })

  it('renders each analytics chart frame + the listings-status legend', async () => {
    mockAnalyticsData()
    renderWithQueryClient(<BusinessDashboard onExit={vi.fn()} auth={makeAuth()} user={analyticsUser} />)
    await waitFor(() => expect(screen.getByText(/Your AshantiHub spend/)).toBeInTheDocument())
    expect(screen.getByText(/Listings by status/)).toBeInTheDocument()
    expect(screen.getByText(/Credit score/)).toBeInTheDocument()
    expect(screen.getByText(/What drives your score/)).toBeInTheDocument()
    expect(screen.getByText(/Plan usage/)).toBeInTheDocument()
    // donut legend, rendered outside the (jsdom-sizeless) chart once the async
    // listings query resolves. Text is split across a colour-swatch span + text
    // nodes, so assert on body textContent and wait for the data to land.
    await waitFor(() => expect(document.body).toHaveTextContent('Published (2)'))
    expect(document.body).toHaveTextContent('Pending Review (1)')
  })
})

describe('BusinessDashboard command-center tab navigation', () => {
  it('opens the Deliveries scaffold with an honest coming-soon state', async () => {
    mockAnalyticsData()
    renderWithQueryClient(<BusinessDashboard onExit={vi.fn()} auth={makeAuth()} user={analyticsUser} />)
    fireEvent.click(await screen.findByRole('button', { name: /🚚 Deliveries/ }))
    expect(await screen.findByText('Delivery tracking is coming soon')).toBeInTheDocument()
    expect(screen.getByText('COMING SOON')).toBeInTheDocument()
    expect(screen.getByText('Out for delivery')).toBeInTheDocument()
  })

  it('opens the Payments tab (ported PaymentDashboard content)', async () => {
    mockAnalyticsData()
    renderWithQueryClient(<BusinessDashboard onExit={vi.fn()} auth={makeAuth()} user={analyticsUser} />)
    fireEvent.click(await screen.findByRole('button', { name: /💳 Payments/ }))
    expect(await screen.findByText('⬇ Export CSV')).toBeInTheDocument()
  })

  it('opens the Credit tab (ported CreditDashboard content)', async () => {
    mockAnalyticsData()
    renderWithQueryClient(<BusinessDashboard onExit={vi.fn()} auth={makeAuth()} user={analyticsUser} />)
    fireEvent.click(await screen.findByRole('button', { name: /🏅 Credit/ }))
    expect(await screen.findByText('🏅 AshantiHub Credit Score System')).toBeInTheDocument()
  })

  it('deep-links to the Payments tab via initialTab (the /payments route)', async () => {
    mockAnalyticsData()
    renderWithQueryClient(
      <BusinessCommandCenter initialTab="payments" onExit={vi.fn()} user={analyticsUser} auth={makeAuth()} PaymentComponent={() => null} />,
    )
    expect(await screen.findByText('⬇ Export CSV')).toBeInTheDocument()
  })

  it('deep-links to the Credit tab via initialTab (the /credit route)', async () => {
    mockAnalyticsData()
    renderWithQueryClient(
      <BusinessCommandCenter initialTab="credit" onExit={vi.fn()} user={analyticsUser} auth={makeAuth()} PaymentComponent={() => null} />,
    )
    expect(await screen.findByText('🏅 AshantiHub Credit Score System')).toBeInTheDocument()
  })
})

describe('BusinessDashboard Products tab (business item 2)', () => {
  const productProfile = { ghana_card_number: 'GHA-1', gps_address: 'AK-1', business_contact_phone: '+233200000000', is_formal: false, business_kind: 'product' }
  const publishedProduct = {
    id: 5, name: 'Kente Cloth', status: 'published', price_amount: '100.00', price_unit: 'per item',
    stock_quantity: 2, has_expiry: false, expiry_date: null, specs: [{ label: 'Color', value: 'Gold' }],
    category: 1, zone: 1,
  }

  it('shows a Products tab only for a product business', async () => {
    mockDashboardData({ profile: productProfile })
    renderWithQueryClient(<BusinessDashboard onExit={vi.fn()} auth={makeAuth()} user={{ fullName: 'Abena', accountType: 'business_owner', kycStatus: 'verified' }} />)
    await waitFor(() => expect(screen.getByRole('button', { name: /Products/ })).toBeInTheDocument())
  })

  it('does not show a Products tab for a service business', async () => {
    mockDashboardData({ profile: { ...productProfile, business_kind: 'service' } })
    renderWithQueryClient(<BusinessDashboard onExit={vi.fn()} auth={makeAuth()} user={{ fullName: 'Abena', accountType: 'business_owner', kycStatus: 'verified' }} />)
    await waitFor(() => expect(screen.getByRole('button', { name: /Services/ })).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /^📦 Products$/ })).not.toBeInTheDocument()
  })

  it('lists a published product with its stock and edits the price via the manage endpoint', async () => {
    let manageBody = null
    server.use(
      http.get('http://localhost:8000/api/listings/mine/', () => HttpResponse.json([publishedProduct])),
      http.get('http://localhost:8000/api/accounts/business-owners/me/profile/', () => HttpResponse.json(productProfile)),
      http.get('http://localhost:8000/api/billing/plans/', () => HttpResponse.json([])),
      http.get('http://localhost:8000/api/billing/subscriptions/me/', () => HttpResponse.json({})),
      http.get('http://localhost:8000/api/hero/mine/', () => HttpResponse.json({})),
      http.patch('http://localhost:8000/api/listings/mine/5/manage/', async ({ request }) => {
        manageBody = await request.json()
        return HttpResponse.json({ id: 5, ...manageBody })
      }),
    )
    renderWithQueryClient(<BusinessDashboard onExit={vi.fn()} auth={makeAuth()} user={{ fullName: 'Abena', accountType: 'business_owner', kycStatus: 'verified' }} />)
    fireEvent.click(await screen.findByRole('button', { name: /Products/ }))
    await screen.findByText('Kente Cloth')
    expect(screen.getByText('2 in stock')).toBeInTheDocument()
    // low stock nudge
    expect(screen.getByText(/Running low/)).toBeInTheDocument()
    fireEvent.click(screen.getByText('✏️ Edit price & specs'))
    const priceInput = await screen.findByDisplayValue('100.00')
    fireEvent.change(priceInput, { target: { value: '120.00' } })
    fireEvent.click(screen.getByText('Save changes'))
    await waitFor(() => expect(manageBody?.price_amount).toBe('120.00'))
  })

  it('restocks a product via the restock endpoint', async () => {
    let restockBody = null
    server.use(
      http.get('http://localhost:8000/api/listings/mine/', () => HttpResponse.json([publishedProduct])),
      http.get('http://localhost:8000/api/accounts/business-owners/me/profile/', () => HttpResponse.json(productProfile)),
      http.get('http://localhost:8000/api/billing/plans/', () => HttpResponse.json([])),
      http.get('http://localhost:8000/api/billing/subscriptions/me/', () => HttpResponse.json({})),
      http.get('http://localhost:8000/api/hero/mine/', () => HttpResponse.json({})),
      http.post('http://localhost:8000/api/listings/mine/5/restock/', async ({ request }) => {
        restockBody = await request.json()
        return HttpResponse.json({ id: 5, stock_quantity: 12 })
      }),
    )
    renderWithQueryClient(<BusinessDashboard onExit={vi.fn()} auth={makeAuth()} user={{ fullName: 'Abena', accountType: 'business_owner', kycStatus: 'verified' }} />)
    fireEvent.click(await screen.findByRole('button', { name: /Products/ }))
    await screen.findByText('Kente Cloth')
    fireEvent.click(screen.getByText('📦 Restock'))
    fireEvent.change(screen.getByPlaceholderText('Add quantity'), { target: { value: '10' } })
    fireEvent.click(screen.getByText('Add to stock'))
    await waitFor(() => expect(restockBody).toEqual({ add: 10 }))
  })
})

describe('BusinessDashboard Services tab (business item 2)', () => {
  const serviceProfile = { ghana_card_number: 'GHA-1', gps_address: 'AK-1', business_contact_phone: '+233200000000', is_formal: false, business_kind: 'service' }

  it('lists an incoming request and accepts it with a quote', async () => {
    let respondBody = null
    server.use(
      http.get('http://localhost:8000/api/listings/mine/', () => HttpResponse.json([])),
      http.get('http://localhost:8000/api/accounts/business-owners/me/profile/', () => HttpResponse.json(serviceProfile)),
      http.get('http://localhost:8000/api/billing/plans/', () => HttpResponse.json([])),
      http.get('http://localhost:8000/api/billing/subscriptions/me/', () => HttpResponse.json({})),
      http.get('http://localhost:8000/api/hero/mine/', () => HttpResponse.json({})),
      http.get('http://localhost:8000/api/services/requests/incoming/', () => HttpResponse.json([
        { id: 3, listing_name: 'Home Cleaning', customer_name: 'Yaa Buyer', message: 'Clean my house', budget: '150.00', agreed_price: null, status: 'requested', created_at: '2026-07-10T00:00:00Z', progress_note: '', decline_reason: '' },
      ])),
      http.post('http://localhost:8000/api/services/requests/3/respond/', async ({ request }) => {
        respondBody = await request.json()
        return HttpResponse.json({ id: 3, status: 'accepted' })
      }),
    )
    renderWithQueryClient(<BusinessDashboard onExit={vi.fn()} auth={makeAuth()} user={{ fullName: 'Abena', accountType: 'business_owner', kycStatus: 'verified' }} />)
    fireEvent.click(await screen.findByRole('button', { name: /Services/ }))
    await screen.findByText('Home Cleaning')
    expect(screen.getByText('"Clean my house"')).toBeInTheDocument()
    fireEvent.click(screen.getByText('✓ Accept & quote'))
    fireEvent.change(screen.getByPlaceholderText('Your price (GHS)'), { target: { value: '180' } })
    fireEvent.click(screen.getByText('Send quote'))
    await waitFor(() => expect(respondBody).toEqual({ action: 'accept', price: '180' }))
  })
})

describe('BusinessDashboard Bookings tab (business item 2)', () => {
  const serviceProfile = { ghana_card_number: 'GHA-1', gps_address: 'AK-1', business_contact_phone: '+233200000000', is_formal: false, business_kind: 'service' }

  it('a service business gets a Bookings tab and can check a guest in', async () => {
    let checkinCalled = false
    server.use(
      http.get('http://localhost:8000/api/listings/mine/', () => HttpResponse.json([])),
      http.get('http://localhost:8000/api/accounts/business-owners/me/profile/', () => HttpResponse.json(serviceProfile)),
      http.get('http://localhost:8000/api/billing/plans/', () => HttpResponse.json([])),
      http.get('http://localhost:8000/api/billing/subscriptions/me/', () => HttpResponse.json({})),
      http.get('http://localhost:8000/api/hero/mine/', () => HttpResponse.json({})),
      http.get('http://localhost:8000/api/services/requests/incoming/', () => HttpResponse.json([])),
      http.get('http://localhost:8000/api/bookings/incoming/', () => HttpResponse.json([
        { id: 8, listing_name: 'Ashanti Lodge', customer_name: 'Ama Guest', check_in: '2026-08-01', check_out: '2026-08-03', nights: 2, units: 1, total_price: '400.00', status: 'confirmed' },
      ])),
      http.post('http://localhost:8000/api/bookings/8/check-in/', () => {
        checkinCalled = true
        return HttpResponse.json({ id: 8, status: 'checked_in' })
      }),
    )
    renderWithQueryClient(<BusinessDashboard onExit={vi.fn()} auth={makeAuth()} user={{ fullName: 'Abena', accountType: 'business_owner', kycStatus: 'verified' }} />)
    fireEvent.click(await screen.findByRole('button', { name: /Bookings/ }))
    await screen.findByText('Ashanti Lodge')
    expect(screen.getByText(/2 nights/)).toBeInTheDocument()
    fireEvent.click(screen.getByText('🔑 Check in'))
    await waitFor(() => expect(checkinCalled).toBe(true))
  })
})

describe('BusinessDashboard Payments rework (business item 4)', () => {
  const productProfile = { ghana_card_number: 'GHA-1', gps_address: 'AK-1', business_contact_phone: '+233200000000', is_formal: false, business_kind: 'product' }

  it('shows a customer sales report in Overview', async () => {
    server.use(
      http.get('http://localhost:8000/api/listings/mine/', () => HttpResponse.json([])),
      http.get('http://localhost:8000/api/accounts/business-owners/me/profile/', () => HttpResponse.json(productProfile)),
      http.get('http://localhost:8000/api/billing/plans/', () => HttpResponse.json([])),
      http.get('http://localhost:8000/api/billing/subscriptions/me/', () => HttpResponse.json({})),
      http.get('http://localhost:8000/api/hero/mine/', () => HttpResponse.json({})),
      http.get('http://localhost:8000/api/orders/owner/report/', () => HttpResponse.json({
        summary: { total_sales: '450.00', order_count: 2, item_count: 3 }, series: [],
        rows: [{ order_id: 1, date: '2026-07-10T00:00:00Z', customer: 'Ama Buyer', item: 'Kente Cloth', kind: 'product', quantity: 2, line_total: '300.00' }],
      })),
    )
    renderWithQueryClient(<BusinessDashboard onExit={vi.fn()} auth={makeAuth()} user={{ fullName: 'Abena', accountType: 'business_owner', kycStatus: 'verified' }} />)
    fireEvent.click(await screen.findByRole('button', { name: /💳 Payments/ }))
    await screen.findByText('Total Sales')
    expect(screen.getByText('GHS 450')).toBeInTheDocument()
    expect(screen.getByText('Kente Cloth', { exact: false })).toBeInTheDocument()
    // The old owner-spend framing is gone.
    expect(screen.queryByText('💰 Payment Overview')).not.toBeInTheDocument()
  })

  it('kind-gates the subscription plan grid (fixes the Wave A gap)', async () => {
    server.use(
      http.get('http://localhost:8000/api/listings/mine/', () => HttpResponse.json([])),
      http.get('http://localhost:8000/api/accounts/business-owners/me/profile/', () => HttpResponse.json(productProfile)),
      http.get('http://localhost:8000/api/billing/subscriptions/me/', () => HttpResponse.json({})),
      http.get('http://localhost:8000/api/hero/mine/', () => HttpResponse.json({})),
      http.get('http://localhost:8000/api/orders/owner/report/', () => HttpResponse.json({ summary: { total_sales: '0.00', order_count: 0, item_count: 0 }, series: [], rows: [] })),
      http.get('http://localhost:8000/api/billing/plans/', () => HttpResponse.json([
        { id: 1, tier: 'product_basic', name: 'Product Basic', kind: 'product', monthly_price: '20.00', features: [], is_recommended: false },
        { id: 2, tier: 'service', name: 'Service Plan', kind: 'service', monthly_price: '30.00', features: [], is_recommended: false },
      ])),
    )
    renderWithQueryClient(<BusinessDashboard onExit={vi.fn()} auth={makeAuth()} user={{ fullName: 'Abena', accountType: 'business_owner', kycStatus: 'verified' }} />)
    fireEvent.click(await screen.findByRole('button', { name: /💳 Payments/ }))
    fireEvent.click(await screen.findByRole('button', { name: /My Transactions & Subscription/ }))
    await screen.findByText('Product Basic')
    // A product business must not see the service plan.
    expect(screen.queryByText('Service Plan')).not.toBeInTheDocument()
  })
})
