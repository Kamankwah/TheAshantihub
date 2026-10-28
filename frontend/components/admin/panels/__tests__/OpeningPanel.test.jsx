import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setSudoHandler } from '../../../../apiClient.js'
import { server } from '../../../../mocks/server.js'
import OpeningPanel from '../OpeningPanel.jsx'

const API = 'http://localhost:8000'
const auth = (perms = ['opening.manage']) => ({ user: { role: 'super_admin' }, hasPermission: (c) => perms.includes(c) })
const snapshot = (over = {}) => ({ opens_at: '2026-11-06T06:00:00Z', server_now: '2026-10-19T09:00:00Z', is_open: false, gate_enabled: true, ...over })

function renderPanel(a = auth()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}><OpeningPanel auth={a} /></QueryClientProvider>)
}
const serve = (over = {}, accounts = []) => server.use(
  http.get(`${API}/api/storefront/opening/`, () => HttpResponse.json(snapshot(over))),
  http.get(`${API}/api/storefront/test-accounts/`, () => HttpResponse.json(accounts)),
)

afterEach(() => setSudoHandler(null))

describe('OpeningPanel', () => {
  it('shows_opening_time_and_delay_requires_reason', async () => {
    serve()
    const posts = []
    server.use(http.post(`${API}/api/storefront/opening/delay/`, async ({ request }) => { posts.push(await request.json()); return HttpResponse.json({}, { status: 201 }) }))
    renderPanel()
    expect(await screen.findByText(/6 November 2026 at 06:00/)).toBeInTheDocument()
    expect(screen.queryByText(/The opening gate is off/)).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/New opening time/), { target: { value: '2026-11-13T06:00' } })
    const submit = screen.getByRole('button', { name: 'Delay opening' })
    expect(submit).toBeDisabled()
    fireEvent.click(submit)
    expect(posts).toHaveLength(0)
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: 'Stock is late' } })
    expect(submit).toBeEnabled()
    fireEvent.click(submit)
    await waitFor(() => expect(posts).toHaveLength(1))
    expect(posts[0]).toEqual({ opens_at: '2026-11-13T06:00:00Z', reason: 'Stock is late' })
  })

  it('says plainly when the gate is off', async () => {
    serve({ gate_enabled: false, is_open: true })
    renderPanel()
    expect(await screen.findByText('The opening gate is off: the marketplace is open to everyone. It is switched on by the server setting MARKETPLACE_GATE_ENABLED.')).toBeInTheDocument()
  })

  it('shows the server refusal', async () => {
    serve()
    server.use(http.post(`${API}/api/storefront/opening/delay/`, () => HttpResponse.json({ detail: 'The new opening time must be later than the current one.' }, { status: 400 })))
    renderPanel()
    fireEvent.change(await screen.findByLabelText(/New opening time/), { target: { value: '2026-11-01T06:00' } })
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: 'x' } })
    fireEvent.click(screen.getByRole('button', { name: 'Delay opening' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('must be later than the current one')
  })

  it('sudo_prompt_flow_retries_once', async () => {
    serve()
    const handler = vi.fn(async () => true)
    setSudoHandler(handler)
    let calls = 0
    server.use(http.post(`${API}/api/storefront/opening/delay/`, () => {
      calls += 1
      return calls === 1 ? HttpResponse.json({ detail: 'Re-enter your password.', code: 'sudo_required' }, { status: 403 }) : HttpResponse.json({}, { status: 201 })
    }))
    renderPanel()
    fireEvent.change(await screen.findByLabelText(/New opening time/), { target: { value: '2026-11-13T06:00' } })
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: 'Late stock' } })
    fireEvent.click(screen.getByRole('button', { name: 'Delay opening' }))
    expect(await screen.findByRole('status')).toHaveTextContent(/Opening delayed/)
    expect(handler).toHaveBeenCalledTimes(1)
    expect(calls).toBe(2)
  })

  it('adds_and_removes_test_account', async () => {
    let accounts = [{ customer: 7, customer_name: 'Ama Test', added_at: '2026-10-19T08:00:00Z' }]
    const seen = { post: [], del: [] }
    server.use(
      http.get(`${API}/api/storefront/opening/`, () => HttpResponse.json(snapshot())),
      http.get(`${API}/api/storefront/test-accounts/`, () => HttpResponse.json(accounts)),
      http.post(`${API}/api/storefront/test-accounts/`, async ({ request }) => { const b = await request.json(); seen.post.push(b); accounts = [...accounts, { customer: b.customer, customer_name: 'Kofi Test', added_at: '2026-10-19T09:00:00Z' }]; return HttpResponse.json({ customer: b.customer }, { status: 201 }) }),
      http.delete(`${API}/api/storefront/test-accounts/`, async ({ request }) => { const b = await request.json().catch(() => ({})); seen.del.push(b); accounts = accounts.filter((a) => a.customer !== b.customer); return new HttpResponse(null, { status: 204 }) }),
    )
    renderPanel()
    expect(await screen.findByText('Ama Test')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/Customer ID/), { target: { value: '9' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add test account' }))
    expect(await screen.findByText('Kofi Test')).toBeInTheDocument()
    expect(seen.post).toEqual([{ customer: 9 }])
    fireEvent.click(screen.getByRole('button', { name: 'Remove Ama Test' }))
    await waitFor(() => expect(screen.queryByText('Ama Test')).not.toBeInTheDocument())
    expect(seen.del).toEqual([{ customer: 7 }])
  })

  it('hidden_for_non_super_admin', () => {
    serve()
    const { container } = renderPanel(auth([]))
    expect(container).toBeEmptyDOMElement()
  })
})
