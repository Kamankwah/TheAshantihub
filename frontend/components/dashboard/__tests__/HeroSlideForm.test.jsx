import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { server } from '../../../mocks/server.js'
import HeroSlideForm from '../HeroSlideForm.jsx'

const API = 'http://localhost:8000'
const slide = (over = {}) => ({
  id: 1, media_type: 'image', media: 'http://x/a.jpg', video_file: null, youtube_url: '', youtube_id: null, title: 'Kente week', caption: 'New stoles',
  starts_at: '2026-11-07T08:00:00Z', ends_at: '2026-11-14T08:00:00Z', status: 'pending', rejection_reason: '', ...over,
})
function renderForm(props = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}><HeroSlideForm {...props} /></QueryClientProvider>)
}
const serve = (slides = []) => server.use(
  http.get(`${API}/api/hero/mine/slides/`, () => HttpResponse.json(slides)),
  http.get(`${API}/api/listings/mine/`, () => HttpResponse.json([{ id: 4, name: 'Kente stole' }])),
)
const pickKind = (name) => fireEvent.click(screen.getByRole('radio', { name }))
const dates = (start, end) => {
  fireEvent.change(screen.getByLabelText('Starts'), { target: { value: start } })
  fireEvent.change(screen.getByLabelText('Ends'), { target: { value: end } })
}
let appendSpy
afterEach(() => appendSpy?.mockRestore())

describe('HeroSlideForm', () => {
  it('blocks_range_over_30_days', async () => {
    serve()
    const posts = []
    server.use(http.post(`${API}/api/hero/submit/`, () => { posts.push(1); return HttpResponse.json({}, { status: 201 }) }))
    renderForm()
    await screen.findByText(/No slides yet/)
    pickKind('Video')
    fireEvent.change(screen.getByLabelText('YouTube link'), { target: { value: 'https://youtu.be/dQw4w9WgXcQ' } })
    dates('2026-11-07T08:00', '2026-12-09T08:00')
    fireEvent.click(screen.getByRole('button', { name: 'Submit slide' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('A hero slide can run for at most 30 days.')
    expect(posts).toHaveLength(0)
  })

  it('requires_one_video_source', async () => {
    serve()
    renderForm()
    await screen.findByText(/No slides yet/)
    pickKind('Video')
    dates('2026-11-07T08:00', '2026-11-14T08:00')
    fireEvent.click(screen.getByRole('button', { name: 'Submit slide' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Give either a video file or a YouTube link, not both and not neither.')
    // both is refused too
    fireEvent.change(screen.getByLabelText('YouTube link'), { target: { value: 'https://youtu.be/dQw4w9WgXcQ' } })
    fireEvent.change(screen.getByLabelText('Video file'), { target: { files: [new File(['v'], 'v.mp4', { type: 'video/mp4' })] } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit slide' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('not both and not neither')
  })

  it('refuses a video over 25 MB and an image over 5 MB before sending', async () => {
    serve()
    renderForm()
    await screen.findByText(/No slides yet/)
    const big = (name, type, size) => { const f = new File(['x'], name, { type }); Object.defineProperty(f, 'size', { value: size }); return f }
    pickKind('Video')
    fireEvent.change(screen.getByLabelText('Video file'), { target: { files: [big('v.mp4', 'video/mp4', 26 * 1024 * 1024)] } })
    expect(await screen.findByRole('alert')).toHaveTextContent('25 MB or smaller')
    pickKind('Image')
    fireEvent.change(screen.getByLabelText('Image file'), { target: { files: [big('a.jpg', 'image/jpeg', 6 * 1024 * 1024)] } })
    expect(await screen.findByRole('alert')).toHaveTextContent('5 MB or smaller')
  })

  it('sends a YouTube slide as form fields and lists it as pending, free of any payment step', async () => {
    let list = []
    server.use(
      http.get(`${API}/api/hero/mine/slides/`, () => HttpResponse.json(list)),
      http.get(`${API}/api/listings/mine/`, () => HttpResponse.json([{ id: 4, name: 'Kente stole' }])),
    )
    appendSpy = vi.spyOn(FormData.prototype, 'append')
    server.use(http.post(`${API}/api/hero/submit/`, () => { list = [slide({ media_type: 'video', media: null, youtube_id: 'dQw4w9WgXcQ', youtube_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' })]; return HttpResponse.json(list[0], { status: 201 }) }))
    renderForm()
    await screen.findByText(/No slides yet/)
    expect(screen.queryByText(/pay|GH₵/i)).not.toBeInTheDocument()
    pickKind('Video')
    fireEvent.change(screen.getByLabelText('YouTube link'), { target: { value: 'https://youtu.be/dQw4w9WgXcQ' } })
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Kente week' } })
    fireEvent.change(screen.getByLabelText('Caption'), { target: { value: 'New stoles' } })
    fireEvent.change(screen.getByLabelText(/Listing/), { target: { value: '4' } })
    dates('2026-11-07T08:00', '2026-11-14T08:00')
    fireEvent.click(screen.getByRole('button', { name: 'Submit slide' }))
    expect(await screen.findByRole('status')).toHaveTextContent(/waiting for approval/i)
    const sent = Object.fromEntries(appendSpy.mock.calls.filter(([k]) => k !== 'starts_at' && k !== 'ends_at'))
    expect(sent).toMatchObject({ media_type: 'video', youtube_url: 'https://youtu.be/dQw4w9WgXcQ', title: 'Kente week', caption: 'New stoles', listing: '4' })
    const keys = appendSpy.mock.calls.map(([k]) => k)
    expect(keys).toEqual(expect.arrayContaining(['starts_at', 'ends_at']))
    const row = (await screen.findByText('Kente week')).closest('li')
    expect(within(row).getByText('Waiting for approval')).toBeInTheDocument()
  })

  it('shows server field errors', async () => {
    serve()
    server.use(http.post(`${API}/api/hero/submit/`, () => HttpResponse.json({ link_path: 'The link must be a page on this site, such as /events.' }, { status: 400 })))
    renderForm()
    await screen.findByText(/No slides yet/)
    pickKind('Video')
    fireEvent.change(screen.getByLabelText('YouTube link'), { target: { value: 'https://youtu.be/dQw4w9WgXcQ' } })
    dates('2026-11-07T08:00', '2026-11-14T08:00')
    fireEvent.click(screen.getByRole('button', { name: 'Submit slide' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('The link must be a page on this site')
  })

  it('lists own slides with pending, approved and rejected status and the reason', async () => {
    serve([
      slide({ id: 1, title: 'Pending one' }),
      slide({ id: 2, title: 'Live one', status: 'approved' }),
      slide({ id: 3, title: 'Refused one', status: 'rejected', rejection_reason: 'Photo is blurry' }),
    ])
    renderForm()
    expect(await screen.findByText('Pending one')).toBeInTheDocument()
    expect(within(screen.getByText('Live one').closest('li')).getByText('Approved')).toBeInTheDocument()
    const refused = screen.getByText('Refused one').closest('li')
    expect(within(refused).getByText('Rejected')).toBeInTheDocument()
    expect(within(refused).getByText(/Photo is blurry/)).toBeInTheDocument()
  })

  it('staff mode posts to the staff endpoint and says it goes live at once', async () => {
    let hit = 0
    server.use(http.post(`${API}/api/hero/staff/`, () => { hit += 1; return HttpResponse.json(slide({ status: 'approved' }), { status: 201 }) }))
    renderForm({ mode: 'staff' })
    expect(screen.getByText(/goes live as soon as it starts/i)).toBeInTheDocument()
    pickKind('Video')
    fireEvent.change(screen.getByLabelText('YouTube link'), { target: { value: 'https://youtu.be/dQw4w9WgXcQ' } })
    dates('2026-11-07T08:00', '2026-11-14T08:00')
    fireEvent.click(screen.getByRole('button', { name: 'Create slide' }))
    await waitFor(() => expect(hit).toBe(1))
  })
})
