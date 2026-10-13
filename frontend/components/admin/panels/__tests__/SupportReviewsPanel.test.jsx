import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../../../mocks/server.js'
import { HIDE_REASONS } from '../../../../lib/reviewHideReasons.js'
import SupportReviewsPanel, { boughtText } from '../SupportReviewsPanel.jsx'

const API = 'http://localhost:8000'
const review = (over = {}) => ({
  id: 1, target_type: 'listing', rating: 5, author_name: 'Nii Armah', comment: 'Best fufu! Call 024 555 0199', verified: true, contains_phone: true,
  open_dispute_order: null, order_id: 13, about_name: "Nana's Chop Bar", target_name: 'Fufu', created_at: '2026-10-07T10:48:00Z', ...over,
})

function setup(rows = [review()], seen = { posts: [] }) {
  server.use(
    http.get(`${API}/api/reviews/moderation/`, () => HttpResponse.json({ count: rows.length, next: null, previous: null, results: rows })),
    http.post(`${API}/api/reviews/moderation/:id/:verb/`, async ({ params, request }) => {
      seen.posts.push([params.verb, await request.json()])
      return HttpResponse.json({ id: Number(params.id), status: 'hidden' })
    }),
  )
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={queryClient}><SupportReviewsPanel /></QueryClientProvider>)
  return seen
}

describe('SupportReviewsPanel', () => {
  it('shows the order number only when the server derived one, else Verified purchase', () => {
    expect(boughtText({ order_id: 13, verified: true })).toBe('Bought · Order #13')
    expect(boughtText({ order_id: null, verified: true })).toBe('Verified purchase')
    expect(boughtText({ order_id: null, verified: false })).toBe('No purchase found')
  })

  it('flags only what the system computed', async () => {
    setup([review({ contains_phone: false, verified: true, order_id: null })])
    const card = await screen.findByRole('article', { name: 'Review by Nii Armah' })
    expect(card).toHaveTextContent('Verified purchase')
    expect(card).toHaveTextContent('No issues found')
  })

  it('hides with one of seven reasons and an editable message', async () => {
    const seen = setup()
    const card = await screen.findByRole('article', { name: 'Review by Nii Armah' })
    expect(card).toHaveTextContent('Contains a phone number')
    fireEvent.click(within(card).getByRole('button', { name: 'Hide…' }))
    const sheet = screen.getByRole('dialog')
    expect(within(sheet).getAllByRole('option')).toHaveLength(HIDE_REASONS.length + 1)
    const box = within(sheet).getByLabelText(/Message to Nii Armah/)
    expect(box.value).toContain("Nana's Chop Bar")
    fireEvent.change(box, { target: { value: 'Please post it again without the number.' } })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Hide and tell reviewer' }))
    await waitFor(() => expect(seen.posts).toContainEqual(['hide', { reason_code: 'contact_details', message: 'Please post it again without the number.' }]))
  })

  it('will not hide without a reason', async () => {
    setup([review({ contains_phone: false })])
    const card = await screen.findByRole('article', { name: 'Review by Nii Armah' })
    fireEvent.click(within(card).getByRole('button', { name: 'Hide…' }))
    expect(screen.getByRole('button', { name: 'Hide and tell reviewer' })).toBeDisabled()
  })

  it('publishes a waiting review', async () => {
    const seen = setup([review({ contains_phone: false })])
    fireEvent.click(await screen.findByRole('button', { name: 'Publish' }))
    await waitFor(() => expect(seen.posts.map(([v]) => v)).toContain('approve'))
  })
})
