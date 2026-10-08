import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { server } from '../../../../mocks/server.js'
import ApprovalsPanel from '../ApprovalsPanel.jsx'

const HOUR = 3600 * 1000
const STALE = 'This changed since it was requested — ask for a fresh request.'

const approval = (overrides = {}) => ({
  id: 7, kind: 'business.update', kind_label: 'Business info change', title: 'Adwoa Fabrics', status: 'pending',
  stage: 'manager', maker: { id: 3, full_name: 'Kwame Asante', role: 'scout' },
  assigned_to: { id: 2, full_name: 'Ama Boateng', role: 'operations' }, pool_permission: 'kyc.approve',
  target: { type: 'accounts.businessowner', id: '5', label: 'Adwoa Fabrics' }, maker_note: 'The owner changed her phone',
  decided_by: null, decided_at: null, decision_note: '', due_at: new Date(Date.now() + 19 * HOUR).toISOString(),
  escalation_level: 0, created_at: new Date(Date.now() - 5 * HOUR).toISOString(), can_decide: true, can_cancel: false,
  ...overrides,
})
const detail = (overrides = {}) => ({
  ...approval(), payload: { phone: '0554000402' }, before: { phone: '0244000118' },
  diff: [{ field: 'phone', before: '0244000118', after: '0554000402' }], stale: false, ...overrides,
})

function renderPanel(props = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <ApprovalsPanel detailId={null} onOpenDetail={() => {}} {...props} />
    </QueryClientProvider>,
  )
}

describe('ApprovalsPanel inbox', () => {
  it('shows counts on the boxes and opens a waiting request', async () => {
    const onOpenDetail = vi.fn()
    server.use(
      http.get('http://localhost:8000/api/approvals/counts/', () => HttpResponse.json({ mine: 1, made: 0, team: 1, decided: 0, can_view_all: false })),
      http.get('http://localhost:8000/api/approvals/', () => HttpResponse.json({ count: 1, next: null, previous: null, results: [approval()] })),
    )
    renderPanel({ onOpenDetail })
    expect(await screen.findByText('Adwoa Fabrics')).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Waiting for me · 1' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('button', { name: /Everything/ })).not.toBeInTheDocument()
    expect(screen.getByText(/moves on in 1[89] h/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Open Adwoa Fabrics' }))
    expect(onOpenDetail).toHaveBeenCalledWith(7)
  })

  it('asks for the box the user picks and says honestly when it is empty', async () => {
    let lastUrl = ''
    server.use(http.get('http://localhost:8000/api/approvals/', ({ request }) => {
      lastUrl = request.url
      return HttpResponse.json({ count: 0, next: null, previous: null, results: [] })
    }))
    renderPanel()
    expect(await screen.findByText(/Nothing is waiting for your decision/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Made by me' }))
    await waitFor(() => expect(lastUrl).toContain('box=made'))
    expect(await screen.findByText(/You haven't asked for any approvals/)).toBeInTheDocument()
  })
})

describe('ApprovalsPanel request', () => {
  it('shows what would change and approves it with a note', async () => {
    let body = null
    server.use(
      http.get('http://localhost:8000/api/approvals/7/', () => HttpResponse.json(detail())),
      http.post('http://localhost:8000/api/approvals/7/approve/', async ({ request }) => {
        body = await request.json()
        return HttpResponse.json(detail({ status: 'approved', can_decide: false }))
      }),
    )
    renderPanel({ detailId: '7' })
    expect(await screen.findByRole('table', { name: 'What would change' })).toBeInTheDocument()
    expect(screen.getByText('0244000118')).toBeInTheDocument()
    expect(screen.getByText('0554000402')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/Note to Kwame Asante/), { target: { value: 'Checked with the owner' } })
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    await waitFor(() => expect(body).toEqual({ note: 'Checked with the owner' }))
  })

  it('needs a note to return a request', async () => {
    let returned = null
    server.use(
      http.get('http://localhost:8000/api/approvals/7/', () => HttpResponse.json(detail())),
      http.post('http://localhost:8000/api/approvals/7/reject/', async ({ request }) => {
        returned = await request.json()
        return HttpResponse.json(detail({ status: 'rejected', can_decide: false }))
      }),
    )
    renderPanel({ detailId: '7' })
    const returnButton = await screen.findByRole('button', { name: 'Return with note' })
    expect(returnButton).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/Note to Kwame Asante/), { target: { value: 'Ask the owner for a photo' } })
    fireEvent.click(returnButton)
    await waitFor(() => expect(returned).toEqual({ note: 'Ask the owner for a photo' }))
  })

  it('blocks approving a request whose target changed', async () => {
    server.use(http.get('http://localhost:8000/api/approvals/7/', () => HttpResponse.json(detail({ stale: true }))))
    renderPanel({ detailId: '7' })
    expect(await screen.findByText(STALE)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled()
  })

  it("tells the maker they can't approve their own request and lets them cancel", async () => {
    let cancelled = false
    server.use(
      http.get('http://localhost:8000/api/approvals/7/', () => HttpResponse.json(detail({ can_decide: false, can_cancel: true }))),
      http.post('http://localhost:8000/api/approvals/7/cancel/', () => { cancelled = true; return HttpResponse.json(detail({ status: 'cancelled', can_cancel: false })) }),
    )
    renderPanel({ detailId: '7' })
    expect(await screen.findByText("You can't approve your own requests.")).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel request' }))
    await waitFor(() => expect(cancelled).toBe(true))
  })

  it('shows the server reason when a decision is refused', async () => {
    server.use(
      http.get('http://localhost:8000/api/approvals/7/', () => HttpResponse.json(detail())),
      http.post('http://localhost:8000/api/approvals/7/approve/', () => HttpResponse.json({ detail: STALE }, { status: 409 })),
    )
    renderPanel({ detailId: '7' })
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(STALE)
  })

  it('goes back to the inbox', async () => {
    const onOpenDetail = vi.fn()
    server.use(http.get('http://localhost:8000/api/approvals/7/', () => HttpResponse.json(detail())))
    renderPanel({ detailId: '7', onOpenDetail })
    fireEvent.click(await screen.findByRole('button', { name: '← Approvals' }))
    expect(onOpenDetail).toHaveBeenCalledWith(null)
  })
})
