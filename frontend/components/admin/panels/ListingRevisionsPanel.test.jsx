import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../../mocks/server.js'
import ListingRevisionsPanel from './ListingRevisionsPanel.jsx'

const API = 'http://localhost:8000'
const EMPTY_MEDIA = { staged_photos: [], remove_photos: [], staged_videos: [], remove_videos: [], remove_video_ids: [], current_main_photo: null, new_main_photo: null }
const row = (o = {}) => ({
  id: 5, listing: 11, listing_name: 'Kente Cloth', listing_status: 'published', business_owner: 3, business_owner_name: 'Akosua Ntoma',
  status: 'pending', rejection_reason: null, reviewed_by_name: null, reviewed_at: null, submitted_at: '2026-10-20T09:00:00Z',
  created_at: '2026-10-20T08:00:00Z', changed_fields: ['name'], made_by_staff: false, created_by_staff: null, ...o,
})
const detail = (o = {}, diff = {}) => ({ ...row(o), diff: { fields: {}, media: EMPTY_MEDIA, variants: [], ...diff } })

function mock(rows, details = {}) {
  server.use(
    http.get(`${API}/api/listings/revisions/pending/`, ({ request }) => {
      const status = new URL(request.url).searchParams.get('status') || 'pending'
      return HttpResponse.json(rows[status] || [])
    }),
    http.get(`${API}/api/listings/revisions/:id/`, ({ params }) => HttpResponse.json(details[params.id])),
  )
}
function renderPanel(auth = { user: { id: 7 } }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={queryClient}><ListingRevisionsPanel auth={auth} /></QueryClientProvider>)
}

describe('ListingRevisionsPanel', () => {
  it('renders pending changes with a before and after for each changed field', async () => {
    mock({ pending: [row()] }, { 5: detail({}, { fields: { name: { old: 'Kente', new: 'Kente Cloth' }, tag: { old: null, new: 'New' } } }) })
    renderPanel()
    expect(await screen.findByText('Kente Cloth', { selector: 'div' })).toBeInTheDocument()
    expect(screen.getByText(/Akosua Ntoma/)).toBeInTheDocument()
    const table = await screen.findByRole('table', { name: 'Changes' })
    const nameRow = within(table).getByText('Name').closest('tr')
    expect(within(nameRow).getByText('Kente')).toBeInTheDocument()
    expect(within(nameRow).getByText('Kente Cloth')).toBeInTheDocument()
    const tagRow = within(table).getByText('Tag').closest('tr')
    expect(within(tagRow).getByText('New')).toBeInTheDocument()
  })

  it('shows nothing for an unchanged field', async () => {
    mock({ pending: [row()] }, { 5: detail({}, { fields: { name: { old: 'Kente', new: 'Kente Cloth' } } }) })
    renderPanel()
    await screen.findByRole('table', { name: 'Changes' })
    expect(screen.queryByText('Description')).not.toBeInTheDocument()
    expect(screen.queryByText('Price')).not.toBeInTheDocument()
  })

  it('shows staged images, struck-through removals, videos and variant changes in plain words', async () => {
    mock({ pending: [row({ changed_fields: ['photos', 'videos', 'variants'] })] }, {
      5: detail({}, {
        media: {
          ...EMPTY_MEDIA,
          staged_photos: [{ id: 1, image: `${API}/media/a.jpg` }],
          remove_photos: [{ id: 2, image: `${API}/media/b.jpg` }],
          staged_videos: [
            { id: 3, kind: 'upload', status: 'ready', url: `${API}/media/v.mp4`, youtube_id: null },
            { id: 4, kind: 'youtube', status: 'ready', url: null, youtube_id: 'dQw4w9WgXcQ' },
            { id: 6, kind: 'youtube', status: 'ready', url: null, youtube_id: 'bad id<script>' },
            { id: 7, kind: 'upload', status: 'processing', url: null, youtube_id: null },
            { id: 8, kind: 'upload', status: 'failed', url: null, youtube_id: null },
          ],
          remove_videos: [{ id: 9, kind: 'upload', status: 'ready', url: `${API}/media/old.mp4`, youtube_id: null }],
        },
        variants: [
          { op: 'add', label: 'Mango', price_amount: '15.00' },
          { op: 'update', id: 1, label: 'Big', current_label: 'Large' },
          { op: 'remove', id: 2, current_label: 'Small' },
        ],
      }),
    })
    renderPanel()
    const container = document.body
    await screen.findByAltText('New photo')
    expect(screen.getByAltText('Photo to be removed')).toHaveStyle({ opacity: '0.5' })
    expect(container.querySelector('video[src$="v.mp4"]')).not.toBeNull()
    expect(container.querySelector('iframe[src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"]')).not.toBeNull()
    expect(container.querySelectorAll('iframe')).toHaveLength(1)
    expect(screen.getByText('Video is still being processed')).toBeInTheDocument()
    expect(screen.getByText('Video could not be processed')).toBeInTheDocument()
    expect(screen.getByText(/Add “Mango” at GHS 15.00/)).toBeInTheDocument()
    expect(screen.getByText(/Rename “Large” to “Big”/)).toBeInTheDocument()
    expect(screen.getByText(/Remove “Small”/)).toBeInTheDocument()
  })

  it('approve posts and refetches', async () => {
    let approved = 0
    let listed = 0
    server.use(
      http.get(`${API}/api/listings/revisions/pending/`, () => { listed += 1; return HttpResponse.json([row()]) }),
      http.get(`${API}/api/listings/revisions/:id/`, () => HttpResponse.json(detail({}, { fields: { name: { old: 'Kente', new: 'Kente Cloth' } } }))),
      http.post(`${API}/api/listings/revisions/5/approve/`, () => { approved += 1; return HttpResponse.json({ id: 5, listing: 11, status: 'approved' }) }),
    )
    renderPanel()
    const button = await screen.findByRole('button', { name: /Approve/ })
    const before = listed
    fireEvent.click(button)
    await waitFor(() => expect(approved).toBe(1))
    await waitFor(() => expect(listed).toBeGreaterThan(before))
  })

  it('reject requires a reason', async () => {
    let body = null
    mock({ pending: [row()] }, { 5: detail({}, { fields: { name: { old: 'Kente', new: 'Kente Cloth' } } }) })
    server.use(http.post(`${API}/api/listings/revisions/5/reject/`, async ({ request }) => { body = await request.json(); return HttpResponse.json({ id: 5, listing: 11, status: 'rejected' }) }))
    renderPanel()
    fireEvent.click(await screen.findByRole('button', { name: /^✕ Reject$/ }))
    const confirm = screen.getByRole('button', { name: 'Confirm reject' })
    expect(confirm).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Reason for rejecting'), { target: { value: 'Photo is blurry' } })
    expect(confirm).toBeEnabled()
    fireEvent.click(confirm)
    await waitFor(() => expect(body).toEqual({ reason: 'Photo is blurry' }))
  })

  it('shows the server message when approval is refused because you made it', async () => {
    mock({ pending: [row()] }, { 5: detail({}, { fields: { name: { old: 'Kente', new: 'Kente Cloth' } } }) })
    server.use(http.post(`${API}/api/listings/revisions/5/approve/`, () => HttpResponse.json({ detail: 'You made this, so someone else must approve it.' }, { status: 403 })))
    renderPanel()
    fireEvent.click(await screen.findByRole('button', { name: /Approve/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('You made this, so someone else must approve it.')
  })

  it('disables Approve on a row the signed-in staff member made', async () => {
    mock({ pending: [row({ made_by_staff: true, created_by_staff: 7 })] }, { 5: detail({ made_by_staff: true, created_by_staff: 7 }, { fields: { name: { old: 'a', new: 'b' } } }) })
    renderPanel({ user: { id: 7 } })
    expect(await screen.findByRole('button', { name: /Approve/ })).toBeDisabled()
    expect(screen.getByText('You made this')).toBeInTheDocument()
  })

  it('leaves Approve on when another staff member made the row', async () => {
    mock({ pending: [row({ made_by_staff: true, created_by_staff: 9 })] }, { 5: detail({ created_by_staff: 9 }, { fields: { name: { old: 'a', new: 'b' } } }) })
    renderPanel({ user: { id: 7 } })
    expect(await screen.findByRole('button', { name: /Approve/ })).toBeEnabled()
    expect(screen.queryByText('You made this')).not.toBeInTheDocument()
  })

  it('history tabs list the changed field names and the rejection reason, without a before and after', async () => {
    mock({ rejected: [row({ status: 'rejected', rejection_reason: 'Photo is blurry', changed_fields: ['name', 'photos'] })] })
    renderPanel()
    fireEvent.click(await screen.findByRole('button', { name: /Rejected/ }))
    expect(await screen.findByText(/Photo is blurry/)).toBeInTheDocument()
    expect(screen.getByText(/Changed: Name, Photos/)).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Review Again/ })).toBeInTheDocument()
  })

  it('empty state says there are no changes waiting', async () => {
    mock({})
    renderPanel()
    expect(await screen.findByText('No changes are waiting for review.')).toBeInTheDocument()
  })
})
