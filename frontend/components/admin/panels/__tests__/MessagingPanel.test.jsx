import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../../../mocks/server.js'
import MessagingPanel from '../MessagingPanel.jsx'

const row = (id, contact) => ({
  id, customer: null, business_owner: null, starter_name: 'Efua Visitor', subject: 'Chat assistant',
  status: 'open', needs_reply: true, last_message_at: '2026-10-19T10:00:00Z', contact,
})

function setup(contact) {
  server.use(
    http.get('http://localhost:8000/api/messaging/staff/', () => HttpResponse.json({ count: 1, next: null, previous: null, results: [row(5, contact)] })),
    http.get('http://localhost:8000/api/messaging/staff/5/', () => HttpResponse.json({ ...row(5, contact), messages: [{ id: 1, sender_type: 'guest', body: 'Late order', created_at: '2026-10-19T10:00:00Z' }] })),
  )
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={queryClient}><MessagingPanel /></QueryClientProvider>)
}

describe('MessagingPanel contact actions', () => {
  it('shows_call_text_email_links_for_contact', async () => {
    setup({ name: 'Efua Visitor', email: 'a@b.com', phone: '+233245553553' })
    fireEvent.click(await screen.findByText(/Efua Visitor/))
    expect(await screen.findByRole('link', { name: 'Call' })).toHaveAttribute('href', 'tel:+233245553553')
    expect(screen.getByRole('link', { name: 'Text' })).toHaveAttribute('href', 'sms:+233245553553')
    expect(screen.getByRole('link', { name: 'Email' })).toHaveAttribute('href', 'mailto:a@b.com')
    expect(screen.getByPlaceholderText('Reply as AshantiHub Support…')).toBeInTheDocument()
  })

  it('shows no contact actions when the thread has no contact', async () => {
    setup(null)
    fireEvent.click(await screen.findByText(/Efua Visitor/))
    await screen.findByText(/Late order/)
    expect(screen.queryByRole('link', { name: 'Call' })).not.toBeInTheDocument()
  })
})
