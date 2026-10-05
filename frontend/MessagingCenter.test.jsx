import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MessagingCenter } from './App.jsx'
import { PHONE_QUERY } from './hooks/useBreakpoint.js'
import { server } from './mocks/server.js'

// On a phone the support chat used to squeeze a conversation list and the
// chat side by side into ~350px. A phone now shows one pane at a time.

const CUSTOMER = { id: 1, fullName: 'Yaw Mensah', accountType: 'customer' }
const CONVERSATION = {
  id: 1, customer: 1, business_owner: null, starter_name: 'Yaw Mensah',
  subject: 'Re: Handwoven kente stole', status: 'open',
  messages: [
    { id: 1, conversation: 1, sender_type: 'customer', body: 'Is the stole available longer?', created_at: '2026-10-05T09:24:00Z' },
    { id: 2, conversation: 1, sender_type: 'staff', body: 'Yes — ready well before December.', created_at: '2026-10-05T09:27:00Z' },
  ],
  created_at: '2026-10-05T09:24:00Z', updated_at: '2026-10-05T09:27:00Z',
}

const realMatchMedia = window.matchMedia

function useViewport(isPhone) {
  window.matchMedia = vi.fn((query) => ({
    matches: isPhone && query === PHONE_QUERY,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
}

function renderCenter() {
  server.use(http.get('http://localhost:8000/api/messaging/conversations/', () => HttpResponse.json([CONVERSATION])))
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MessagingCenter user={CUSTOMER} onClose={vi.fn()} initialBusiness={{ name: 'Handwoven kente stole' }} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
})

afterEach(() => {
  window.matchMedia = realMatchMedia
})

describe('MessagingCenter on a phone', () => {
  it('opens straight into the conversation, without the side-by-side list', async () => {
    useViewport(true)
    renderCenter()
    await screen.findByText('Yes — ready well before December.')
    expect(screen.getByPlaceholderText('Type a message...')).toBeInTheDocument()
    expect(screen.queryByText(/Start New Conversation/)).not.toBeInTheDocument()
  })

  it('goes back to the conversation list and into a conversation again', async () => {
    useViewport(true)
    renderCenter()
    await screen.findByText('Yes — ready well before December.')

    fireEvent.click(screen.getByRole('button', { name: 'Back to conversations' }))
    expect(screen.getByText(/Start New Conversation/)).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('Type a message...')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('Re: Handwoven kente stole'))
    expect(await screen.findByText('Yes — ready well before December.')).toBeInTheDocument()
    expect(screen.queryByText(/Start New Conversation/)).not.toBeInTheDocument()
  })
})

describe('MessagingCenter on a desktop', () => {
  it('keeps the conversation list and the chat side by side', async () => {
    useViewport(false)
    renderCenter()
    await screen.findByText('Yes — ready well before December.')
    expect(screen.getByText(/Start New Conversation/)).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Type a message...')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Back to conversations' })).not.toBeInTheDocument()
  })
})
