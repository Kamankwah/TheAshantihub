import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../../../../mocks/server.js'
import AnalyticsPanel from '../../AnalyticsPanel.jsx'
import CategoriesZonesPanel from '../../CategoriesZonesPanel.jsx'
import EventsModerationPanel from '../../EventsModerationPanel.jsx'
import HeroApprovalPanel from '../../HeroApprovalPanel.jsx'
import PromotionsPanel from '../../PromotionsPanel.jsx'
import ReportsPanel from '../../ReportsPanel.jsx'
import { API, renderMk } from './mkTestUtils.jsx'

const pass = (key, label, detail = '') => ({ key, label, status: 'pass', detail, blocking: false })
const hero = (over = {}) => ({
  id: 7, business_owner: 1, business_owner_name: 'Asafo Hair Studio', listing: 3, listing_name: 'Knotless braids',
  media: 'http://x/y.jpg', media_type: 'image', caption: 'Call 026 123 4567 to book', status: 'pending', rejection_reason: null,
  submitted_at: '2026-10-13T08:00:00Z', approved_at: null, expires_at: null, reviewed_by_name: null, reviewed_at: null,
  can_approve: false,
  checks: [
    pass('photo', 'Photo is from this listing', 'Matches a photo on “Knotless braids”.'),
    pass('kyc', 'Business verified (KYC)'),
    pass('caption_length', 'Caption within 140 characters', '25 of 140 characters.'),
    { key: 'contact_details', label: 'No contact details in the caption', status: 'fail', blocking: true, detail: 'Businesses are never contacted directly.' },
    pass('hero_slots', 'Hero slot available on their plan', '0 of 1 hero slot in use.'),
  ],
  ...over,
})
const serveHero = ({ pending = [hero()], decisions = [] } = {}) => server.use(
  http.get(`${API}/api/listings/hero/pending/`, ({ request }) => HttpResponse.json(new URL(request.url).searchParams.get('status') === 'pending' ? pending : [])),
  http.get(`${API}/api/listings/hero/my-decisions/`, () => HttpResponse.json(decisions)),
)

describe('Hero approval (Marketing)', () => {
  it('renders the server checks and blocks approval when the caption carries contact details', async () => {
    serveHero()
    renderMk(HeroApprovalPanel, { permissions: ['hero_media.approve'] })
    const checks = await screen.findByRole('list', { name: 'Hero checks' })
    expect(within(checks).getAllByRole('listitem')).toHaveLength(5)
    expect(checks).toHaveTextContent('Failed: No contact details in the caption')
    expect(checks).toHaveTextContent('Passed: Photo is from this listing')
    expect(screen.getByRole('button', { name: /Approve .* blocked by the caption check/ })).toBeDisabled()
    expect(screen.getByText(/Needs attention: No contact details in the caption/)).toBeInTheDocument()
  })

  it('rejects with the chosen reason and the note combined', async () => {
    serveHero()
    const bodies = []
    server.use(http.post(`${API}/api/listings/hero/7/reject/`, async ({ request }) => { bodies.push(await request.json()); return HttpResponse.json({ id: 7, status: 'rejected' }) }))
    renderMk(HeroApprovalPanel, { permissions: ['hero_media.approve'] })
    await screen.findByRole('list', { name: 'Hero checks' })
    fireEvent.change(screen.getByLabelText(/Message to the business/), { target: { value: 'Please remove the number.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Reject with reason' }))
    await waitFor(() => expect(bodies).toEqual([{ reason: 'Contact details in the caption. Please remove the number.' }]))
  })

  it('approves a clean submission and shows the server message if it refuses', async () => {
    serveHero({ pending: [hero({ caption: 'Handwoven kente', can_approve: true, checks: [pass('contact_details', 'No contact details in the caption')] })] })
    server.use(http.post(`${API}/api/listings/hero/7/approve/`, () => HttpResponse.json({ detail: 'This caption carries contact details.', code: 'contact_details_in_caption' }, { status: 400 })))
    renderMk(HeroApprovalPanel, { permissions: ['hero_media.approve'] })
    const approve = await screen.findByRole('button', { name: 'Approve' })
    expect(approve).toBeEnabled()
    fireEvent.click(approve)
    expect(await screen.findByRole('alert')).toHaveTextContent('This caption carries contact details.')
  })

  it('lists my recent decisions', async () => {
    serveHero({ pending: [], decisions: [{ id: 1, business_owner_name: "Nana's Chop Bar", caption: 'Jollof Fridays', status: 'approved', reviewed_at: '2026-10-06T10:00:00Z' }] })
    renderMk(HeroApprovalPanel, { permissions: ['hero_media.approve'] })
    expect(await screen.findByText('Nothing is waiting for review.')).toBeInTheDocument()
    const recent = screen.getByRole('list', { name: 'Decided recently' })
    expect(recent).toHaveTextContent("Nana's Chop Bar")
    expect(recent).toHaveTextContent('Approved')
  })

  it('keeps the plain tabs for other roles', async () => {
    serveHero()
    renderMk(HeroApprovalPanel, { permissions: ['hero_media.approve'], props: { auth: { user: { role: 'operations' }, hasPermission: () => true } } })
    expect(await screen.findByText(/Asafo Hair Studio/)).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Hero checks' })).not.toBeInTheDocument()
  })
})

const promo = (over = {}) => ({
  id: 4, listing: 3, listing_name: 'Fried rice', business_owner_name: "Nana's Chop Bar", kind: 'featured',
  starts_at: '2026-10-13T00:00:00Z', ends_at: '2026-10-20T00:00:00Z', keywords: '', amount_paid: '210.00', status: 'pending',
  rejection_reason: '', is_currently_active: false, created_at: '2026-10-12T00:00:00Z', paid_days: 7, days_left: null, slot: null, fraud_hold: null,
  checks: [pass('kyc', 'Business verified (KYC)'), pass('subscription', 'Subscription paid'), pass('listing_live', 'Listing live')],
  ...over,
})
const servePromos = (byStatus) => server.use(http.get(`${API}/api/listings/promotions/`, ({ request }) => HttpResponse.json(byStatus[new URL(request.url).searchParams.get('status')] || [])))

describe('Promotions (Marketing)', () => {
  it('shows the check line and approves', async () => {
    servePromos({ pending: [promo()] })
    const posts = []
    server.use(http.post(`${API}/api/listings/promotions/4/approve/`, () => { posts.push('approve'); return HttpResponse.json(promo({ status: 'active' })) }))
    renderMk(PromotionsPanel, { permissions: ['promotions.manage'] })
    const line = await screen.findByRole('list', { name: 'Checks' })
    expect(line).toHaveTextContent('Business verified (KYC)')
    expect(line).toHaveTextContent('Listing live')
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    await waitFor(() => expect(posts).toEqual(['approve']))
  })

  it('holds a promotion with an open fraud case, naming the case owner, and cannot approve it', async () => {
    servePromos({ pending: [promo({ fraud_hold: { case_id: 9, title: 'Looks fake', case_owner_name: 'Kwame Asante' } })] })
    renderMk(PromotionsPanel, { permissions: ['promotions.manage'] })
    expect(await screen.findByText(/Held: open fraud case “Looks fake”. Case owner: Kwame Asante/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled()
  })

  it('failed checks name what is wrong, and a server fraud-hold refusal is shown', async () => {
    servePromos({ pending: [promo({ checks: [{ key: 'kyc', label: 'Business verified (KYC)', status: 'fail', detail: 'KYC is pending.' }] })] })
    server.use(http.post(`${API}/api/listings/promotions/4/approve/`, () => HttpResponse.json({ detail: 'This business has an open fraud case. Case owner: Kwame Asante.', code: 'fraud_hold' }, { status: 409 })))
    renderMk(PromotionsPanel, { permissions: ['promotions.manage'] })
    expect(await screen.findByText(/Business verified \(KYC\) — KYC is pending\./)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Case owner: Kwame Asante')
  })

  it('shows days left on active rows and says cancelling is not a refund', async () => {
    servePromos({ pending: [], active: [promo({ status: 'active', is_currently_active: true, days_left: 5 })] })
    renderMk(PromotionsPanel, { permissions: ['promotions.manage'] })
    fireEvent.click(await screen.findByRole('button', { name: 'Active' }))
    expect(await screen.findByText('5 days left')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Cancelling is not a refund')
    expect(screen.getByRole('alertdialog')).toHaveTextContent('GH₵ 210.00 stays paid')
  })

  it('needs a reason to reject', async () => {
    servePromos({ pending: [promo()] })
    const bodies = []
    server.use(http.post(`${API}/api/listings/promotions/4/reject/`, async ({ request }) => { bodies.push(await request.json()); return HttpResponse.json(promo({ status: 'rejected' })) }))
    renderMk(PromotionsPanel, { permissions: ['promotions.manage'] })
    fireEvent.click(await screen.findByRole('button', { name: 'Reject' }))
    const confirm = screen.getByRole('button', { name: 'Confirm reject' })
    expect(confirm).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/Reason for rejecting/), { target: { value: 'Listing is a duplicate' } })
    fireEvent.click(confirm)
    await waitFor(() => expect(bodies).toEqual([{ reason: 'Listing is a duplicate' }]))
  })
})

const cat = (over) => ({ id: 1, slug: 'phones', icon: 'x', label: 'Phones', color: '#006400', kind: 'product', is_accommodation: false, listing_count: 0, event_count: 0, ...over })

describe('Categories (Marketing)', () => {
  it('shows usage counts, offers Delete only when unused, and no zones', async () => {
    server.use(http.get(`${API}/api/listings/categories/`, () => HttpResponse.json([cat({ id: 1, label: 'Phones', listing_count: 210, event_count: 0 }), cat({ id: 2, label: 'Unused', slug: 'unused' })])))
    renderMk(CategoriesZonesPanel, { permissions: ['categories.manage'] })
    const phones = (await screen.findByRole('rowheader', { name: /Phones/ })).closest('tr')
    expect(phones).toHaveTextContent('210')
    expect(within(phones).getByText('In use')).toBeInTheDocument()
    expect(within(phones).queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
    expect(within(screen.getByRole('rowheader', { name: /Unused/ }).closest('tr')).getByRole('button', { name: 'Delete' })).toBeInTheDocument()
    expect(screen.queryByText('Zones')).not.toBeInTheDocument()
  })

  it('shows the server refusal in full when a delete is turned down', async () => {
    server.use(
      http.get(`${API}/api/listings/categories/`, () => HttpResponse.json([cat({ label: 'Race' })])),
      http.delete(`${API}/api/listings/categories/1/`, () => HttpResponse.json({ detail: '1 listing use this category. Reassign or remove them before deleting it.' }, { status: 409 })),
    )
    renderMk(CategoriesZonesPanel, { permissions: ['categories.manage'] })
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('wasn’t deleted. 1 listing use this category.')
  })

  it('adds a category with a theme swatch colour', async () => {
    server.use(http.get(`${API}/api/listings/categories/`, () => HttpResponse.json([])))
    const bodies = []
    server.use(http.post(`${API}/api/listings/categories/`, async ({ request }) => { bodies.push(await request.json()); return HttpResponse.json(cat(), { status: 201 }) }))
    renderMk(CategoriesZonesPanel, { permissions: ['categories.manage'] })
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Tailoring Shops' } })
    expect(screen.getByLabelText('Web address')).toHaveValue('tailoring-shops')
    fireEvent.click(screen.getByRole('radio', { name: 'Navy' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add category' }))
    await waitFor(() => expect(bodies).toHaveLength(1))
    expect(bodies[0]).toMatchObject({ slug: 'tailoring-shops', label: 'Tailoring Shops', color: '#000080', kind: 'service', is_accommodation: false })
    expect(screen.getAllByRole('radio').map((r) => r.getAttribute('aria-label'))).toContain('Deep gold')
  })

  it('keeps categories and zones together for Operations', async () => {
    server.use(http.get(`${API}/api/listings/categories/`, () => HttpResponse.json([])), http.get(`${API}/api/listings/zones/`, () => HttpResponse.json([{ id: 1, name: 'Adum' }])))
    renderMk(CategoriesZonesPanel, { permissions: ['zones.manage'], props: { auth: { user: { role: 'operations' }, hasPermission: () => true } } })
    expect(await screen.findByText('Adum')).toBeInTheDocument()
  })
})

const stats = (over = {}) => ({
  days: 30, customers: 12, business_owners: 3, listings: 20, orders: 40, orders_paid: 31, events: 2, hero_submissions: 5,
  promotions_bought: 4, promotions_started: 3, promotion_revenue: '105.00', opt_ins: { state: 'not_tracked', note: 'No opt-ins recorded yet.' }, ...over,
})

describe('Analytics (Marketing)', () => {
  it('asks for the chosen period and says no opt-ins are recorded', async () => {
    const asked = []
    server.use(http.get(`${API}/api/marketing/analytics/`, ({ request }) => { const d = Number(new URL(request.url).searchParams.get('days')); asked.push(d); return HttpResponse.json(stats({ days: d, customers: d })) }))
    renderMk(AnalyticsPanel, { permissions: ['analytics.view'] })
    const group = await screen.findByRole('group', { name: 'Last 30 days' })
    expect(within(screen.getByRole('group', { name: 'Opt-ins' })).getByText('No opt-ins recorded yet.')).toBeInTheDocument()
    expect(group).toHaveTextContent('GH₵ 105.00')
    fireEvent.click(screen.getByRole('button', { name: 'Last 7 days' }))
    expect(await screen.findByRole('group', { name: 'Last 7 days' })).toHaveTextContent('7')
    fireEvent.click(screen.getByRole('button', { name: '90 days' }))
    await screen.findByRole('group', { name: 'Last 90 days' })
    expect(asked).toEqual(expect.arrayContaining([30, 7, 90]))
    expect(screen.getByRole('group', { name: 'Export analytics' })).toBeInTheDocument()
    expect(screen.getByText('Not recorded yet')).toBeInTheDocument()
  })

  it('shows the ledger count once opt-ins exist', async () => {
    server.use(http.get(`${API}/api/marketing/analytics/`, () => HttpResponse.json(stats({ opt_ins: { state: 'tracked', opted_in: 14, opted_out: 3, note: 'Counted from the consent ledger.' } }))))
    renderMk(AnalyticsPanel, { permissions: ['analytics.view'] })
    const tile = await screen.findByRole('group', { name: 'Opt-ins' })
    expect(tile).toHaveTextContent('14')
    expect(tile).toHaveTextContent('3 opted out')
  })
})

describe('Events (Marketing)', () => {
  const event = { id: 5, name: 'Kumasi Kente Night', category: { label: 'Culture' }, zone: { name: 'Adum' }, visibility_days: 14, submitted_by_business_name: 'Akosua Ntoma', status: 'pending' }
  it('needs one of the offered reasons to reject, and tells the organiser what follows approval', async () => {
    server.use(http.get(`${API}/api/events/moderation/pending/`, ({ request }) => HttpResponse.json(new URL(request.url).searchParams.get('status') === 'pending' ? [event] : [])))
    const bodies = []
    server.use(http.post(`${API}/api/events/moderation/5/reject/`, async ({ request }) => { bodies.push(await request.json()); return HttpResponse.json({ id: 5, status: 'rejected' }) }))
    renderMk(EventsModerationPanel, { permissions: ['event.approve'] })
    fireEvent.click(await screen.findByRole('button', { name: '✕ Reject' }))
    const confirm = screen.getByRole('button', { name: 'Confirm reject' })
    expect(confirm).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Reason for rejecting'), { target: { value: 'Duplicate of a live event' } })
    fireEvent.change(screen.getByLabelText('Note to the organiser'), { target: { value: 'Same as Friday show' } })
    fireEvent.click(confirm)
    await waitFor(() => expect(bodies).toEqual([{ reason: 'Duplicate of a live event. Same as Friday show' }]))
    expect(screen.getByText(/Approval alone doesn't put an event on the site; only payment does/)).toBeInTheDocument()
  })
})

describe('Reports (Marketing)', () => {
  it('shows the locked system numbers beside the export, history and roll-up note', async () => {
    server.use(http.get(`${API}/api/reports/current/`, () => HttpResponse.json({
      id: null, staff: { id: 3, full_name: 'Akua Sarpong', role: 'marketing' }, period: 'day', period_start: '2026-10-13', period_end: '2026-10-13',
      status: 'draft', submitted_at: null, is_late: false, due_at: '2026-10-13T19:00:00Z', achievements: '', blockers: '', plan_next: [], plan_results: [],
      linked_targets: [], reviewer: null, reviewed_at: null, review_note: '', similarity: 0, similar_warning: false, can_edit: true, can_review: false,
      system_is_live: true, system: [{ key: 'marketing_moderation', title: 'Moderation decided by you', rows: [{ label: 'Hero approved', value: 2 }] }],
    })))
    renderMk(ReportsPanel, { permissions: [], props: { auth: { user: { id: 3, role: 'marketing', manager: { full_name: 'Simon Peter' } }, hasPermission: () => false } } })
    expect(await screen.findByText('Moderation decided by you')).toBeInTheDocument()
    expect(screen.getByText('Hero approved')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Submit to Simon Peter' })).toBeInTheDocument()
    expect(screen.getByText('Week and month')).toBeInTheDocument()
    expect(screen.getByText('Export')).toBeInTheDocument()
  })
})
