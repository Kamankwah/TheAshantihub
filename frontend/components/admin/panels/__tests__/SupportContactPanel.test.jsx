import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../../../mocks/server.js'
import SupportContactPanel from '../SupportContactPanel.jsx'

const API = 'http://localhost:8000'
const message = (over = {}) => ({
  id: 5, category: 'sales', name: 'Kwadwo Ampofo', email: 'kw•••@gmail.com', phone: '024 *** 0731', subject: 'I sell shoes at Adum. How do I join?',
  message: 'I want to sell on AshantiHub.', status: 'new', created_at: '2026-10-07T11:05:00Z', resolved_by_name: null, replies: [], has_email: true,
  account: null, match: null, passed_to_operations_at: null, passed_by_name: null, ...over,
})

function setup(rows = [message()], seen = { posts: [] }) {
  server.use(
    http.get(`${API}/api/core/contact-messages/`, () => HttpResponse.json({ count: rows.length, next: null, previous: null, results: rows })),
    http.post(`${API}/api/core/contact-messages/:id/:verb/`, async ({ params, request }) => {
      seen.posts.push([params.verb, await request.json().catch(() => ({}))])
      return HttpResponse.json({ ok: true }, { status: 200 })
    }),
  )
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={queryClient}><SupportContactPanel auth={{ hasPermission: () => true }} onNavigate={() => {}} /></QueryClientProvider>)
  return seen
}

describe('SupportContactPanel', () => {
  it('shows a masked message with no account match', async () => {
    setup()
    const article = await screen.findByRole('article', { name: 'Message' })
    expect(article).toHaveTextContent('kw•••@gmail.com')
    expect(article).toHaveTextContent('024 *** 0731')
    expect(article).toHaveTextContent('No account with this email or phone')
    expect(screen.getByRole('button', { name: /Unread · 1/ })).toBeInTheDocument()
  })

  it('shows the matched account with masked details', async () => {
    setup([message({ account: { customer_id: 3, name: 'Kwadwo A', email: 'kw•••@gmail.com', phone: '024 *** 0731' } })])
    expect(await screen.findByText(/Kwadwo A \(kw•••@gmail.com · 024 \*\*\* 0731\)/)).toBeInTheDocument()
  })

  it('sends a reply by email and does not offer a conversation', async () => {
    const seen = setup()
    await screen.findByRole('article', { name: 'Message' })
    expect(screen.queryByRole('button', { name: /conversation/i })).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Reply by email'), { target: { value: 'Hello Kwadwo.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send email' }))
    await waitFor(() => expect(seen.posts).toContainEqual(['reply', { body: 'Hello Kwadwo.' }]))
  })

  it('warns and hides the email box when there is no email', async () => {
    setup([message({ has_email: false, email: '' })])
    expect(await screen.findByText(/no email address/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Reply by email')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Send email' })).not.toBeInTheDocument()
  })

  it('marks a read message unread and passes a message to Operations with a note', async () => {
    const seen = setup([message({ status: 'read' })])
    await screen.findByRole('article', { name: 'Message' })
    fireEvent.click(screen.getByRole('button', { name: 'Mark unread' }))
    await waitFor(() => expect(seen.posts.map(([v]) => v)).toContain('mark-unread'))
    fireEvent.click(screen.getByRole('button', { name: 'Pass to Operations as a lead' }))
    fireEvent.change(screen.getByLabelText(/Note for the Operations lead/), { target: { value: 'Adum shop' } })
    fireEvent.click(screen.getByRole('button', { name: 'Pass it on' }))
    await waitFor(() => expect(seen.posts).toContainEqual(['pass-to-operations', { note: 'Adum shop' }]))
  })

  it('lists replies already sent and says when one was not sent', async () => {
    setup([message({ replies: [{ id: 1, staff_name: 'Esi Nyarko', body: 'Thanks for writing.', email_sent: false, sent_at: '2026-10-07T12:00:00Z' }] })])
    const list = await screen.findByRole('list', { name: 'Replies sent' })
    expect(within(list).getByText(/email not sent/)).toBeInTheDocument()
  })
})
