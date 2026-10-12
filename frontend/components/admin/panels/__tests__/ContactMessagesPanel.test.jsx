import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../../../mocks/server.js'
import ContactMessagesPanel from '../ContactMessagesPanel.jsx'

const API = 'http://localhost:8000'
const msg = (over = {}) => ({
  id: 1, category: 'support', name: 'Kwadwo', email: 'kw@example.com', phone: '', subject: 'Renew button says payment failed', message: 'I tried three times.',
  status: 'new', resolved_by_name: null, resolved_at: null, created_at: '2026-10-07T06:52:00Z',
  match: { business_id: 5, business: 'Kumasi Leather Works', account_manager: 'Efua Mensah', kyc_status: 'verified' }, ...over,
})
function renderPanel(results, seen = [], perms = ['contact_messages.manage', 'calls.log']) {
  server.use(http.get(`${API}/api/core/contact-messages/`, ({ request }) => {
    seen.push(Object.fromEntries(new URL(request.url).searchParams))
    return HttpResponse.json({ count: results.length, next: null, previous: null, results })
  }))
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={queryClient}><ContactMessagesPanel auth={{ hasPermission: (c) => perms.includes(c) }} /></QueryClientProvider>)
}

describe('ContactMessagesPanel', () => {
  it('shows the matched business with its account manager and no match line when none is found', async () => {
    renderPanel([msg(), msg({ id: 2, subject: 'Do you have someone in Ejisu?', match: null })])
    expect(await screen.findByText('Matched: Kumasi Leather Works · Efua Mensah')).toBeInTheDocument()
    expect(screen.getAllByText(/Matched:/)).toHaveLength(1)
    expect(screen.getByText(/never a business's/)).toBeInTheDocument()
  })

  it('asks the server for the tab and the category', async () => {
    const seen = []
    renderPanel([msg()], seen)
    await screen.findByText('Renew button says payment failed')
    expect(seen[0]).toEqual({ status: 'open' })
    fireEvent.click(screen.getByRole('button', { name: 'New' }))
    await waitFor(() => expect(seen.at(-1)).toMatchObject({ status: 'new' }))
    fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'sales' } })
    await waitFor(() => expect(seen.at(-1)).toMatchObject({ status: 'new', category: 'sales' }))
  })

  it('marks a message read and resolves it with the existing endpoints', async () => {
    const calls = []
    server.use(
      http.post(`${API}/api/core/contact-messages/1/read/`, () => { calls.push('read'); return HttpResponse.json({}) }),
      http.post(`${API}/api/core/contact-messages/1/resolve/`, () => { calls.push('resolve'); return HttpResponse.json({}) }),
    )
    renderPanel([msg()])
    fireEvent.click(await screen.findByRole('button', { name: 'Mark read' }))
    await waitFor(() => expect(calls).toEqual(['read']))
    fireEvent.click(screen.getByRole('button', { name: 'Resolve' }))
    await waitFor(() => expect(calls).toEqual(['read', 'resolve']))
  })

  it('shows who resolved a message and offers no actions on it', async () => {
    renderPanel([msg({ status: 'resolved', resolved_by_name: 'Esi Nyarko', resolved_at: '2026-10-03T10:00:00Z' })])
    expect(await screen.findByText(/Resolved by Esi Nyarko/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Resolve' })).not.toBeInTheDocument()
  })

  it('offers Log a call only for a matched message and a caller who may log calls', async () => {
    renderPanel([msg(), msg({ id: 2, match: null })])
    await screen.findAllByRole('button', { name: 'Resolve' })
    expect(screen.getAllByRole('button', { name: 'Log a call' })).toHaveLength(1)
  })
})
