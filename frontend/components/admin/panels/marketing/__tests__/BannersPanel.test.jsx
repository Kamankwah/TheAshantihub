import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { apiPostForm } from '../../../../../apiClient.js'
import { server } from '../../../../../mocks/server.js'
import BannersPanel from '../BannersPanel.jsx'
import { API, renderMk } from './mkTestUtils.jsx'

// jsdom's fetch cannot carry multipart bodies through msw, so the upload call is observed directly.
vi.mock('../../../../../apiClient.js', async (original) => ({ ...(await original()), apiPostForm: vi.fn(async () => ({ id: 9 })) }))

const banner = (over = {}) => ({
  id: 1, slot: 'home_strip', slot_label: 'Home · middle strip', category: null, title: 'Sell on AshantiHub', alt_text: 'A scout', image: 'x.jpg', link_path: '/register',
  sponsored: false, internal_note: '', starts_at: '2026-10-01T00:00:00Z', ends_at: '2026-10-31T00:00:00Z', state: 'approved', phase: 'live', approval_id: 4, approved_by: 'Simon Peter',
  approved_at: '2026-09-30T00:00:00Z', return_note: '', views: 0, clicks: 0, ctr: null, created_by: 'Akua', created_at: '2026-09-29T00:00:00Z', ...over,
})
const list = (banners) => ({
  banners, slots: [{ key: 'home_strip', label: 'Home · middle strip', size: '1600 × 300' }, { key: 'category_top', label: 'Category · top', size: '1200 × 300' }],
  categories: [{ id: 3, slug: 'food', label: 'Food' }], counters_note: 'Views and clicks are first-party counts made by this site\'s own pages. They began at zero when banners launched.',
})
const PERM = ['site_promo.manage']

describe('BannersPanel', () => {
  it('says there are no banners yet and states that counters are first-party', async () => {
    server.use(http.get(`${API}/api/marketing/site-banners/`, () => HttpResponse.json(list([]))))
    renderMk(BannersPanel, { permissions: PERM })
    expect(await screen.findByText(/No banners yet/)).toBeInTheDocument()
    expect(screen.getByText(/first-party counts/)).toBeInTheDocument()
  })

  it('shows real counters, click-through only when there are views, and honest dashes otherwise', async () => {
    server.use(http.get(`${API}/api/marketing/site-banners/`, () => HttpResponse.json(list([banner({ views: 200, clicks: 5, ctr: 2.5 }), banner({ id: 2, title: 'Zero', views: 0, clicks: 0, ctr: null })]))))
    renderMk(BannersPanel, { permissions: PERM })
    const row = (await screen.findByText('Sell on AshantiHub')).closest('tr')
    expect(within(row).getByText('2.5%')).toBeInTheDocument()
    expect(within(screen.getByText('Zero').closest('tr')).getByText('—')).toBeInTheDocument()
  })

  it('offers the right actions for each state and no actions without permission', async () => {
    server.use(http.get(`${API}/api/marketing/site-banners/`, () => HttpResponse.json(list([
      banner({ id: 1, title: 'Live one' }), banner({ id: 2, title: 'Draft one', state: 'draft', phase: '' }), banner({ id: 3, title: 'Waiting one', state: 'waiting', phase: '' }),
      banner({ id: 4, title: 'Returned one', state: 'rejected', phase: '', return_note: 'Use a real photo' }),
    ]))))
    const { unmount } = renderMk(BannersPanel, { permissions: PERM })
    const live = (await screen.findByText('Live one')).closest('tr')
    expect(within(live).getByRole('button', { name: 'Take down' })).toBeInTheDocument()
    expect(within(live).getByRole('button', { name: 'Reschedule' })).toBeInTheDocument()
    expect(within(screen.getByText('Draft one').closest('tr')).getByRole('button', { name: 'Send for approval' })).toBeInTheDocument()
    expect(within(screen.getByText('Waiting one').closest('tr')).getByRole('button', { name: 'Withdraw' })).toBeInTheDocument()
    expect(screen.getByText(/Returned: Use a real photo/)).toBeInTheDocument()
    unmount()
    renderMk(BannersPanel, { permissions: [] })
    await screen.findByText('Live one')
    expect(screen.queryByRole('button', { name: 'Take down' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'New banner' })).toBeNull()
  })

  it('sends a draft for approval and tells the maker it waits for Super Admin', async () => {
    let called = false
    server.use(
      http.get(`${API}/api/marketing/site-banners/`, () => HttpResponse.json(list([banner({ state: 'draft', phase: '' })]))),
      http.post(`${API}/api/marketing/site-banners/1/submit/`, () => { called = true; return HttpResponse.json(banner({ state: 'waiting' })) }),
    )
    renderMk(BannersPanel, { permissions: PERM })
    fireEvent.click(await screen.findByRole('button', { name: 'Send for approval' }))
    await waitFor(() => expect(called).toBe(true))
    expect(await screen.findByText(/goes live only when they approve it/)).toBeInTheDocument()
  })

  it('asks before taking down and shows the server refusal', async () => {
    server.use(
      http.get(`${API}/api/marketing/site-banners/`, () => HttpResponse.json(list([banner()]))),
      http.post(`${API}/api/marketing/site-banners/1/take-down/`, () => HttpResponse.json({ detail: 'Only an approved banner can be taken down.' }, { status: 409 })),
    )
    renderMk(BannersPanel, { permissions: PERM })
    fireEvent.click(await screen.findByRole('button', { name: 'Take down' }))
    fireEvent.click(screen.getByRole('button', { name: 'Yes, take down' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Only an approved banner can be taken down.')
  })

  it('creates a draft from the form with the photo', async () => {
    server.use(http.get(`${API}/api/marketing/site-banners/`, () => HttpResponse.json(list([]))))
    renderMk(BannersPanel, { permissions: PERM })
    fireEvent.click(await screen.findByRole('button', { name: 'New banner' }))
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Kente Friday' } })
    fireEvent.change(screen.getByLabelText('Alt text (describe the photo)'), { target: { value: 'A weaver' } })
    fireEvent.change(screen.getByLabelText('Starts'), { target: { value: '2026-10-20T09:00' } })
    fireEvent.change(screen.getByLabelText(/^Photo/), { target: { files: [new File(['x'], 'p.jpg', { type: 'image/jpeg' })] } })
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }))
    await waitFor(() => expect(apiPostForm).toHaveBeenCalled())
    const [path, body] = apiPostForm.mock.calls[0]
    expect(path).toBe('/api/marketing/site-banners/')
    expect(body.get('title')).toBe('Kente Friday')
    expect(body.get('slot')).toBe('home_strip')
    expect(body.get('image').name).toBe('p.jpg')
  })
})
