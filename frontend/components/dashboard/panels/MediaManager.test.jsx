import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { server } from '../../../mocks/server.js'
import MediaManager from './MediaManager.jsx'

const API = 'http://localhost:8000'
const photo = (id) => ({ id, image: `https://cdn.test/${id}.jpg`, order: id, staged: false })
const video = (id, extra = {}) => ({ id, kind: 'upload', status: 'ready', youtube_id: '', url: 'v.mp4', poster: null, staged: false, error: '', ...extra })
const file = (name, type, size) => { const f = new File(['x'], name, { type }); Object.defineProperty(f, 'size', { value: size }); return f }

function renderManager(listing, props = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><MediaManager listing={listing} onChanged={vi.fn()} {...props} /></QueryClientProvider>)
}

afterEach(() => { vi.useRealTimers() })

describe('MediaManager', () => {
  it('blocks a tenth image and a third video before posting', async () => {
    let posts = 0
    server.use(
      http.post(`${API}/api/listings/mine/3/photos/`, () => { posts += 1; return HttpResponse.json({}, { status: 201 }) }),
      http.post(`${API}/api/listings/mine/3/videos/`, () => { posts += 1; return HttpResponse.json({}, { status: 201 }) }),
    )
    // Main photo + 8 gallery images = 9; two videos already.
    renderManager({ id: 3, status: 'draft', main_photo: 'https://cdn.test/main.jpg', photos: [1, 2, 3, 4, 5, 6, 7, 8].map(photo), videos: [video(1), video(2)] })
    expect(screen.getByText(/Images 9 of 9/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Add image'), { target: { files: [file('a.jpg', 'image/jpeg', 1000)] } })
    expect(await screen.findByText(/at most 9 images/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Upload video'), { target: { files: [file('a.mp4', 'video/mp4', 1000)] } })
    expect(await screen.findByText(/at most 2 videos/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('YouTube link'), { target: { value: 'https://youtu.be/abcdefghijk' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add link' }))
    expect(await screen.findByText(/at most 2 videos/)).toBeInTheDocument()
    expect(posts).toBe(0)
  })

  it('rejects a file over the stated size client-side and still trusts the server error', async () => {
    let posts = 0
    server.use(http.post(`${API}/api/listings/mine/3/photos/`, () => { posts += 1; return HttpResponse.json({ detail: 'This edit is waiting for review.' }, { status: 400 }) }))
    renderManager({ id: 3, status: 'published', main_photo: null, photos: [], videos: [] })
    expect(screen.getByText(/up to 5 MB each/)).toBeInTheDocument()
    expect(screen.getByText(/up to 100 MB and 60 seconds/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Add image'), { target: { files: [file('big.jpg', 'image/jpeg', 6 * 1024 * 1024)] } })
    expect(await screen.findByText(/at most 5 MB/)).toBeInTheDocument()
    expect(posts).toBe(0)
    // A file inside the limits goes to the server, whose refusal is shown verbatim.
    fireEvent.change(screen.getByLabelText('Add image'), { target: { files: [file('ok.png', 'image/png', 1000)] } })
    expect(await screen.findByText('This edit is waiting for review.')).toBeInTheDocument()
    expect(posts).toBe(1)
  })

  it('shows a YouTube link as a ready video, staged items as waiting, and a converting upload', () => {
    renderManager({
      id: 3, status: 'published', main_photo: null, photos: [{ ...photo(1), staged: true }],
      videos: [video(1, { kind: 'youtube', youtube_id: 'abcdefghijk' }), video(2, { status: 'processing', staged: true })],
    })
    expect(screen.getByText('YouTube video')).toBeInTheDocument()
    expect(screen.getByText('Ready')).toBeInTheDocument()
    expect(screen.getByText('Converting…')).toBeInTheDocument()
    expect(screen.getAllByText('Waiting for approval').length).toBe(2)
  })

  it('refetches on a modest interval while a video converts, and stops when none does', () => {
    vi.useFakeTimers()
    const onChanged = vi.fn()
    const converting = { id: 3, status: 'draft', main_photo: null, photos: [], videos: [video(1, { status: 'processing' })] }
    const view = renderManager(converting, { onChanged })
    act(() => { vi.advanceTimersByTime(5000) })
    expect(onChanged).toHaveBeenCalledTimes(1)
    const client = new QueryClient()
    view.rerender(<QueryClientProvider client={client}><MediaManager listing={{ ...converting, videos: [video(1)] }} onChanged={onChanged} /></QueryClientProvider>)
    act(() => { vi.advanceTimersByTime(20000) })
    expect(onChanged).toHaveBeenCalledTimes(1)
  })

  it('shows a queued removal as waiting for approval', async () => {
    server.use(http.get(`${API}/api/listings/mine/3/revision/`, () => HttpResponse.json({ id: 1, status: 'draft', remove_photo_ids: [1], remove_video_ids: [] })))
    renderManager({ id: 3, status: 'published', main_photo: null, photos: [photo(1)], videos: [], pending_revision: { id: 1, status: 'draft', rejection_reason: '' } })
    expect(await screen.findByText('Removal waiting for approval')).toBeInTheDocument()
  })
})
