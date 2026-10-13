import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { server } from '../../../../mocks/server.js'
import NotificationCenterPanel from '../NotificationCenterPanel.jsx'

const API = 'http://localhost:8000'
const n = (id, over = {}) => ({ id, kind: 'approval_waiting', title: `Approval ${id}`, body: 'Info change', link: 'approvals', icon: '✅', is_read: false, created_at: '2026-10-13T08:00:00Z', ...over })
const wrap = (ui) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>)

describe('NotificationCenterPanel', () => {
  it('lists notifications with kinds, filters by kind and says only in-app exists', async () => {
    const seen = []
    server.use(http.get(`${API}/api/notifications/`, ({ request }) => {
      const q = Object.fromEntries(new URL(request.url).searchParams); seen.push(q)
      return HttpResponse.json({ unread_count: 2, kinds: [{ kind: 'approval_waiting', total: 2 }, { kind: 'fraud_flag_raised', total: 1 }], results: q.kind ? [n(3, { kind: 'fraud_flag_raised', title: 'Fraud case: x', link: 'fraud-cases' })] : [n(1), n(2, { is_read: true })] })
    }))
    wrap(<NotificationCenterPanel onNavigate={() => {}} />)
    expect(await screen.findByText('Approval 1')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Approval waiting · 2' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Fraud case · 1' }))
    expect(await screen.findByText('Fraud case: x')).toBeInTheDocument()
    expect(seen.at(-1).kind).toBe('fraud_flag_raised')
    expect(screen.getByText(/In-app only/)).toBeInTheDocument()
    expect(screen.getByText(/Push, SMS and e-mail notices are not connected/)).toBeInTheDocument()
  })

  it('marks one read and opens its screen', async () => {
    const read = []
    const go = vi.fn()
    server.use(
      http.get(`${API}/api/notifications/`, () => HttpResponse.json({ unread_count: 1, kinds: [], results: [n(1)] })),
      http.post(`${API}/api/notifications/:id/read/`, ({ params }) => { read.push(params.id); return HttpResponse.json({}) }),
    )
    wrap(<NotificationCenterPanel onNavigate={go} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Open: Approval 1' }))
    await waitFor(() => expect(go).toHaveBeenCalledWith('approvals'))
    expect(read).toEqual(['1'])
  })

  it('does not offer to open a screen this person does not have', async () => {
    server.use(http.get(`${API}/api/notifications/`, () => HttpResponse.json({ unread_count: 1, kinds: [], results: [n(1, { link: 'payouts' })] })))
    wrap(<NotificationCenterPanel onNavigate={() => {}} knownScreens={new Set(['approvals'])} />)
    await screen.findByText('Approval 1')
    expect(screen.queryByRole('button', { name: 'Open: Approval 1' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Mark as read: Approval 1' })).toBeInTheDocument()
  })

  it('marks all read', async () => {
    let all = 0
    server.use(
      http.get(`${API}/api/notifications/`, () => HttpResponse.json({ unread_count: 2, kinds: [], results: [n(1), n(2)] })),
      http.post(`${API}/api/notifications/read-all/`, () => { all += 1; return HttpResponse.json({ unread_count: 0 }) }),
    )
    wrap(<NotificationCenterPanel />)
    await screen.findByText('Approval 1')
    fireEvent.click(screen.getByRole('button', { name: 'Mark all as read' }))
    await waitFor(() => expect(all).toBe(1))
  })
})
