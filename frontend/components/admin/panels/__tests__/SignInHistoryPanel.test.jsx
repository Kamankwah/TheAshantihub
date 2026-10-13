import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../../../mocks/server.js'
import SignInHistoryPanel from '../SignInHistoryPanel.jsx'

const API = 'http://localhost:8000'
const line = (id, over = {}) => ({ id, at: '2026-10-13T08:03:00Z', kind: 'signed_in', kind_label: 'Signed in', who: { id: 4, name: 'Esi Nyarko', role: 'support' }, identifier: 'es***@example.com', two_factor: true, note: '', ip: '154.160.24.91', device: 'Chrome on Android device', ...over })
const payload = (over = {}) => ({
  count: 3, page: 1, has_next: false, history_starts: '2026-10-13T07:00:00Z',
  summary: { signed_in_24h: 5, refused_24h: 2, two_step_failed_24h: 1, signed_in_now: 3 },
  failed_recent: [{ kind: 'sign_in_failed', who: '', identifier: 'gh***@example.com', attempts: 2 }],
  people: [{ id: 4, full_name: 'Esi Nyarko' }],
  results: [
    line(1),
    line(2, { kind: 'sign_in_failed', kind_label: 'Sign-in refused', who: null, two_factor: false, note: 'Wrong password or unknown address', device: '', ip: null }),
    line(3, { kind: 'timed_out', kind_label: 'Timed out', note: '30 minutes without activity' }),
  ], ...over,
})
const wrap = (ui) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>)

describe('SignInHistoryPanel', () => {
  it('says when the history starts and lists lines with device, address and 2-step', async () => {
    server.use(http.get(`${API}/api/staff-security/sign-ins/`, () => HttpResponse.json(payload())))
    wrap(<SignInHistoryPanel />)
    expect(await screen.findByText(/History starts at 13 October 2026/)).toBeInTheDocument()
    const first = (await screen.findAllByText('Esi Nyarko', { selector: 'span' }))[0].closest('tr')
    expect(first).toHaveTextContent('Esi Nyarko')
    expect(first).toHaveTextContent('Chrome on Android device')
    expect(first).toHaveTextContent('154.160.24.91')
    expect(first).toHaveTextContent('Used')
    expect(screen.getByRole('group', { name: 'Refused, last 24 hours' })).toHaveTextContent('2')
  })

  it('shows an address nobody holds masked and as having no account, with no address or device invented', async () => {
    server.use(http.get(`${API}/api/staff-security/sign-ins/`, () => HttpResponse.json(payload())))
    wrap(<SignInHistoryPanel />)
    const refused = (await screen.findByText('Sign-in refused', { selector: 'span' })).closest('tr')
    expect(refused).toHaveTextContent('no account')
    expect(refused).toHaveTextContent('Not recorded')
    expect(screen.getByText('Wrong password or unknown address')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Failed attempts, last 24 hours' })).toHaveTextContent('2 refused sign-ins for gh***@example.com (no account)')
  })

  it('does not claim any history before it began', async () => {
    server.use(http.get(`${API}/api/staff-security/sign-ins/`, () => HttpResponse.json(payload({ count: 0, results: [], history_starts: null, failed_recent: [] }))))
    wrap(<SignInHistoryPanel />)
    expect(await screen.findByText(/Nothing has been recorded yet\. History starts with the next sign-in/)).toBeInTheDocument()
    expect(screen.getByText('Nothing matches those filters.')).toBeInTheDocument()
  })

  it('sends the filters to the server', async () => {
    const seen = []
    server.use(http.get(`${API}/api/staff-security/sign-ins/`, ({ request }) => { seen.push(Object.fromEntries(new URL(request.url).searchParams)); return HttpResponse.json(payload()) }))
    wrap(<SignInHistoryPanel />)
    await screen.findByText(/History starts/)
    fireEvent.change(screen.getByLabelText('What happened'), { target: { value: 'sign_in_failed' } })
    fireEvent.change(screen.getByLabelText('Person'), { target: { value: '4' } })
    await waitFor(() => expect(seen.at(-1)).toMatchObject({ kind: 'sign_in_failed', staff: '4' }))
  })
})
