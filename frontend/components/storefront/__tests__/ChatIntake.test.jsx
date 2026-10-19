import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { server } from '../../../mocks/server.js'
import ChatIntake from '../ChatIntake.jsx'

const URL = 'http://localhost:8000/api/messaging/conversations/'

function renderIntake(props = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <ChatIntake user={null} onClose={vi.fn()} onContinue={vi.fn()} {...props} />
    </QueryClientProvider>,
  )
}
const next = () => fireEvent.click(screen.getByRole('button', { name: 'Next' }))
const type = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } })

async function toIssueStep() {
  type('Your name', 'Efua Visitor'); next()
  type('Your email', 'a@b.com'); next()
  type('Your phone number', '0245553553'); next()
}

describe('ChatIntake', () => {
  beforeEach(() => localStorage.clear())

  it('asks_name_email_phone_in_order', () => {
    renderIntake()
    expect(screen.getByLabelText('Your name')).toBeInTheDocument()
    expect(screen.queryByLabelText('Your email')).not.toBeInTheDocument()
    type('Your name', 'Efua'); next()
    expect(screen.getByLabelText('Your email')).toBeInTheDocument()
    expect(screen.queryByLabelText('Your phone number')).not.toBeInTheDocument()
    type('Your email', 'a@b.com'); next()
    expect(screen.getByLabelText('Your phone number')).toBeInTheDocument()
  })

  it('rejects_bad_email_and_phone', () => {
    renderIntake()
    type('Your name', 'Efua'); next()
    type('Your email', 'not-an-email'); next()
    expect(screen.getByRole('alert')).toHaveTextContent(/valid email/i)
    expect(screen.getByLabelText('Your email')).toBeInTheDocument()
    type('Your email', 'a@b.com'); next()
    type('Your phone number', '12345'); next()
    expect(screen.getByRole('alert')).toHaveTextContent(/Ghana phone/i)
    for (const ok of ['0245553553', '+233245553553', '233 24 555 3553']) {
      type('Your phone number', ok); next()
      expect(screen.getByText('Welcome, Efua. What can we help you with?')).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    }
  })

  it('welcomes_by_name_then_asks_issue', async () => {
    renderIntake()
    await toIssueStep()
    expect(screen.getByText('Welcome, Efua Visitor. What can we help you with?')).toBeInTheDocument()
    expect(screen.getByLabelText('Your message')).toBeInTheDocument()
  })

  it('posts_chatbot_source_without_business_link', async () => {
    let posted = null
    server.use(http.post(URL, async ({ request }) => {
      posted = await request.json()
      return HttpResponse.json({ id: 7, messages: [] }, { status: 201 })
    }))
    const onContinue = vi.fn()
    renderIntake({ onContinue })
    await toIssueStep()
    type('Your message', 'My order is late')
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(await screen.findByText(/Support has your message and will contact you/)).toBeInTheDocument()
    expect(posted).toMatchObject({
      source: 'chatbot', body: 'My order is late', contact_name: 'Efua Visitor',
      contact_email: 'a@b.com', contact_phone: '0245553553',
    })
    expect(posted.guest_token).toBe(localStorage.getItem('ashantihub.guest_token'))
    expect(Object.keys(posted).some((k) => k.startsWith('about_'))).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Open my conversation' }))
    expect(onContinue).toHaveBeenCalled()
  })

  it('omits the guest token for a signed-in user', async () => {
    let posted = null
    server.use(http.post(URL, async ({ request }) => {
      posted = await request.json()
      return HttpResponse.json({ id: 7, messages: [] }, { status: 201 })
    }))
    renderIntake({ user: { accountType: 'customer', fullName: 'Ama' } })
    await toIssueStep()
    type('Your message', 'Hello')
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await screen.findByText(/Support has your message/)
    expect(posted.guest_token).toBeUndefined()
  })

  it('shows_no_bot_answer', async () => {
    server.use(http.post(URL, () => HttpResponse.json(
      { id: 7, messages: [{ id: 1, sender_type: 'guest', body: 'x' }] }, { status: 201 })))
    const { container } = renderIntake()
    await toIssueStep()
    type('Your message', 'Where is my order?')
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await screen.findByText(/Support has your message/)
    expect(container.textContent).not.toMatch(/tracking|your order is|here is|we found/i)
  })

  it('shows a server field error on the right step', async () => {
    server.use(http.post(URL, () => HttpResponse.json(
      { contact_email: ['Enter a valid email address.'] }, { status: 400 })))
    renderIntake()
    await toIssueStep()
    type('Your message', 'Hi')
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(screen.getByLabelText('Your email')).toBeInTheDocument())
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a valid email address.')
  })
})
