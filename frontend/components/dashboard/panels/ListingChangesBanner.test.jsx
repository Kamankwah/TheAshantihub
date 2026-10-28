import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { server } from '../../../mocks/server.js'
import ListingChangesBanner from './ListingChangesBanner.jsx'

const API = 'http://localhost:8000'

describe('ListingChangesBanner', () => {
  it('shows nothing when there is no open edit', () => {
    const { container } = render(<ListingChangesBanner listing={{ id: 4, pending_revision: null }} onChanged={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('banner shows awaiting approval with discard', async () => {
    let submitted = 0
    let discarded = 0
    server.use(
      http.post(`${API}/api/listings/mine/4/revision/submit/`, () => { submitted += 1; return HttpResponse.json({}) }),
      http.delete(`${API}/api/listings/mine/4/revision/`, () => { discarded += 1; return new HttpResponse(null, { status: 204 }) }),
    )
    const onChanged = vi.fn()
    render(<ListingChangesBanner listing={{ id: 4, pending_revision: { id: 1, status: 'draft', rejection_reason: '' } }} onChanged={onChanged} />)
    expect(screen.getByText(/Your approved version is live\. Your changes are waiting for approval/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Submit/ }))
    await waitFor(() => expect(submitted).toBe(1))
    fireEvent.click(screen.getByRole('button', { name: /Discard/ }))
    await waitFor(() => expect(discarded).toBe(1))
    expect(onChanged).toHaveBeenCalledTimes(2)
  })

  it('shows the server refusal when submitting is refused', async () => {
    server.use(http.post(`${API}/api/listings/mine/4/revision/submit/`, () => HttpResponse.json({ detail: 'Wait for your video to finish converting, then send it.' }, { status: 400 })))
    render(<ListingChangesBanner listing={{ id: 4, pending_revision: { id: 1, status: 'draft', rejection_reason: '' } }} onChanged={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /Submit/ }))
    expect(await screen.findByText('Wait for your video to finish converting, then send it.')).toBeInTheDocument()
  })

  it('a waiting edit has no buttons', () => {
    render(<ListingChangesBanner listing={{ id: 4, pending_revision: { id: 1, status: 'pending', rejection_reason: '' } }} onChanged={vi.fn()} />)
    expect(screen.getByText(/waiting for approval/)).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('banner shows the rejection reason and lets the owner resubmit', () => {
    const onEdit = vi.fn()
    render(<ListingChangesBanner listing={{ id: 4, pending_revision: { id: 1, status: 'rejected', rejection_reason: 'The photo is blurry.' } }} onChanged={vi.fn()} onEdit={onEdit} />)
    expect(screen.getByText(/The photo is blurry\./)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Edit and resubmit' }))
    expect(onEdit).toHaveBeenCalled()
  })

  it('builds its URLs from basePath', async () => {
    let hit = false
    server.use(http.post(`${API}/api/direct/listings/4/revision/submit/`, () => { hit = true; return HttpResponse.json({}) }))
    render(<ListingChangesBanner basePath="/api/direct/listings" listing={{ id: 4, pending_revision: { id: 1, status: 'draft', rejection_reason: '' } }} onChanged={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /Submit/ }))
    await waitFor(() => expect(hit).toBe(true))
  })
})
