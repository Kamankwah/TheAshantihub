import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../../../mocks/server.js'
import HeroApprovalPanel from '../HeroApprovalPanel.jsx'

const API = 'http://localhost:8000'
const hero = (o = {}) => ({
  id: 1, business_owner_name: 'Akosua Ntoma Kente', created_by_staff_name: null, media: 'http://x/a.jpg', media_type: 'image', title: 'Kente week', caption: 'New stoles',
  video_file: null, youtube_url: '', youtube_id: null, starts_at: '2026-11-07T08:00:00Z', ends_at: '2026-11-14T08:00:00Z', status: 'pending',
  submitted_at: '2026-10-19T10:00:00Z', reviewed_by_name: null, reviewed_by_role: null, reviewed_at: null, rejection_reason: '', can_approve: true, checks: [], ...o,
})
function wrap(role, perms = ['hero_media.approve']) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const auth = { user: { role }, hasPermission: (c) => perms.includes(c) }
  return render(<QueryClientProvider client={queryClient}><HeroApprovalPanel auth={auth} /></QueryClientProvider>)
}
const serve = (pending) => server.use(
  http.get(`${API}/api/listings/hero/pending/`, ({ request }) => HttpResponse.json(new URL(request.url).searchParams.get('status') === 'pending' ? pending : [])),
  http.get(`${API}/api/listings/hero/my-decisions/`, () => HttpResponse.json([])),
)

describe('HeroApprovalPanel previews and dates', () => {
  describe.each(['operations', 'marketing'])('approve_reject_for_marketing_and_operations (%s)', (role) => {
    it('approves, and rejects with a reason where the face offers it', async () => {
      {
      const calls = []
      serve([hero()])
      server.use(
        http.post(`${API}/api/listings/hero/1/approve/`, () => { calls.push('approve'); return HttpResponse.json({}) }),
        http.post(`${API}/api/listings/hero/1/reject/`, async ({ request }) => { calls.push(['reject', (await request.json()).reason]); return HttpResponse.json({}) }),
      )
      const { unmount } = wrap(role)
      expect((await screen.findAllByText(/New stoles/)).length).toBeGreaterThan(0)
      // dates and the 30-day note on both faces
      expect(screen.getAllByText(/7 Nov/).length).toBeGreaterThan(0)
      expect(screen.getAllByText(/at most 30 days/i).length).toBeGreaterThan(0)
      fireEvent.click(screen.getByRole('button', { name: /^(✓ )?Approve$/ }))
      await waitFor(() => expect(calls).toContain('approve'))
      if (role === 'operations') {
        fireEvent.click(screen.getByRole('button', { name: '✕ Reject' }))
        fireEvent.change(screen.getByPlaceholderText('Rejection reason'), { target: { value: 'Blurry' } })
        fireEvent.click(screen.getByRole('button', { name: 'Confirm reject' }))
        await waitFor(() => expect(calls).toContainEqual(['reject', 'Blurry']))
      }
      unmount()
      }
    })
  })

  it('previews a YouTube slide with a no-cookie embed and an uploaded video with controls (operations)', async () => {
    serve([
      hero({ id: 1, media_type: 'video', media: null, youtube_id: 'dQw4w9WgXcQ', youtube_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', caption: 'Tube one' }),
      hero({ id: 2, media_type: 'video', media: null, video_file: 'http://x/v.mp4', caption: 'File one' }),
    ])
    const { container } = wrap('operations')
    expect(await screen.findByText(/Tube one/)).toBeInTheDocument()
    const frame = container.querySelector('iframe')
    expect(frame.getAttribute('src')).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ')
    expect(container.querySelector('video[src="http://x/v.mp4"]')).not.toBeNull()
  })

  it('previews a YouTube slide in the Marketing detail and shows a staff-made slide as such', async () => {
    serve([hero({ id: 3, business_owner_name: null, created_by_staff_name: 'Akua Sarpong', media_type: 'video', media: null, youtube_id: 'dQw4w9WgXcQ', youtube_url: 'x', caption: 'Day one' })])
    const { container } = wrap('marketing')
    expect((await screen.findAllByText(/Day one/)).length).toBeGreaterThan(0)
    expect(container.querySelector('iframe[src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"]')).not.toBeNull()
    expect(screen.getAllByText(/AshantiHub \(Akua Sarpong\)/).length).toBeGreaterThan(0)
  })

  it('marks an old submission without dates honestly', async () => {
    serve([hero({ starts_at: null, ends_at: null })])
    wrap('operations')
    expect(await screen.findByText(/No dates \(submitted before slides had dates\)/)).toBeInTheDocument()
  })

  it('shows the day-one slide form to holders of hero_media.approve on the Marketing face and posts to the staff endpoint', async () => {
    serve([])
    let hit = 0
    server.use(http.post(`${API}/api/hero/staff/`, () => { hit += 1; return HttpResponse.json(hero({ status: 'approved' }), { status: 201 }) }))
    wrap('marketing')
    fireEvent.click(await screen.findByRole('button', { name: 'New slide' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Video' }))
    fireEvent.change(screen.getByLabelText('YouTube link'), { target: { value: 'https://youtu.be/dQw4w9WgXcQ' } })
    fireEvent.change(screen.getByLabelText('Starts'), { target: { value: '2026-11-06T06:00' } })
    fireEvent.change(screen.getByLabelText('Ends'), { target: { value: '2026-11-20T06:00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create slide' }))
    await waitFor(() => expect(hit).toBe(1))
    expect(within(await screen.findByRole('status')).getByText(/live/i)).toBeInTheDocument()
  })
})
