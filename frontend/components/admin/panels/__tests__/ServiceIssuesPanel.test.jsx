import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../../../mocks/server.js'
import ServiceIssuesPanel from '../ServiceIssuesPanel.jsx'

const API = 'http://localhost:8000'
const ISSUES = ['service_issues.view', 'staff.invite_team', 'fraud.manage', 'fraud.flag', 'portfolio.manage']
const auth = (perms = ISSUES) => ({ user: { id: 2, role: 'operations' }, hasPermission: (c) => perms.includes(c) })
const issue = (over = {}) => ({
  key: 'chat-4', type: 'chat', type_label: 'Owner chat', id: 4, business: 'Adwoa Fabrics', business_id: 5, account_manager: 'Kwame Asante', account_manager_id: 8,
  what: 'we paid on Saturday', detail: 'We paid the subscription on Saturday', from: 'Adwoa', handled_by: 'Support', opened_at: '2026-10-07T08:00:00Z', open_seconds: 10800,
  status: 'open', resolved_at: null, ...over,
})
const payload = (issues, over = {}) => ({ issues, open_total: issues.length, counts: { contact: 0, dispute: 0, chat: issues.length }, resolved_this_week: 6, managers: [{ id: 8, name: 'Kwame Asante' }], ...over })

function serve(build, seen = []) {
  server.use(http.get(`${API}/api/operations/service-issues/`, ({ request }) => {
    seen.push(Object.fromEntries(new URL(request.url).searchParams))
    return HttpResponse.json(build(new URL(request.url).searchParams))
  }))
}
function renderPanel(props = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}><ServiceIssuesPanel auth={auth()} onOpenBusiness={() => {}} {...props} /></QueryClientProvider>)
}

describe('ServiceIssuesPanel', () => {
  it('lists the issues with their account manager, handler and age, and the honest scope note', async () => {
    serve(() => payload([issue(), issue({ key: 'contact-1', type: 'contact', type_label: 'Contact form', business: 'Kumasi Leather Works', what: 'Renew fails', handled_by: 'Not picked up yet', open_seconds: 18000 })]))
    renderPanel()
    const row = (await screen.findByText('Adwoa Fabrics')).closest('tr')
    expect(row).toHaveTextContent('Owner chat')
    expect(row).toHaveTextContent('Kwame Asante')
    expect(row).toHaveTextContent('Support')
    expect(row).toHaveTextContent('3 h')
    expect(screen.getByText('Not picked up yet')).toBeInTheDocument()
    expect(screen.getByText(/Customer conversations about a business only carry a “Re:” subject line/)).toBeInTheDocument()
    expect(screen.getByText(/Resolved this week: 6/)).toBeInTheDocument()
  })

  it('sends the filters to the server', async () => {
    const seen = []
    serve(() => payload([issue()]), seen)
    renderPanel()
    await screen.findByText('Adwoa Fabrics')
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'dispute' } })
    await waitFor(() => expect(seen.at(-1)).toMatchObject({ type: 'dispute', status: 'open' }))
    fireEvent.change(screen.getByLabelText('Account manager'), { target: { value: '8' } })
    await waitFor(() => expect(seen.at(-1)).toMatchObject({ type: 'dispute', manager: '8' }))
    fireEvent.click(screen.getByRole('button', { name: 'Resolved this week' }))
    await waitFor(() => expect(seen.at(-1).status).toBe('resolved'))
  })

  it('shows an honest empty state', async () => {
    serve(() => payload([]))
    renderPanel()
    expect(await screen.findByText("Nothing open on your team's businesses.")).toBeInTheDocument()
  })

  it('opens a detail with no reply control and gives a task to the account manager', async () => {
    serve(() => payload([issue()]))
    let task
    server.use(http.post(`${API}/api/tasks/`, async ({ request }) => { task = await request.json(); return HttpResponse.json({ id: 1 }, { status: 201 }) }))
    renderPanel()
    fireEvent.click(await screen.findByRole('button', { name: /Adwoa Fabrics/ }))
    const detail = await screen.findByRole('complementary')
    expect(within(detail).getByText('We paid the subscription on Saturday')).toBeInTheDocument()
    expect(within(detail).getByText(/Payments are simulated until Hubtel is connected/)).toBeInTheDocument()
    expect(within(detail).queryByRole('button', { name: /reply/i })).not.toBeInTheDocument()
    fireEvent.click(within(detail).getByRole('button', { name: 'Create task for Kwame Asante' }))
    fireEvent.click(screen.getByRole('button', { name: 'Give to Kwame Asante' }))
    expect(await screen.findByText('Task given to Kwame Asante.')).toBeInTheDocument()
    expect(task).toMatchObject({ owner: 8 })
    expect(task.title).toContain('Adwoa Fabrics')
  })

  it('raises a fraud case about the business', async () => {
    serve(() => payload([issue()]))
    let body
    server.use(http.post(`${API}/api/fraud/flags/`, async ({ request }) => { body = await request.json(); return HttpResponse.json({ id: 1 }, { status: 201 }) }))
    renderPanel()
    fireEvent.click(await screen.findByRole('button', { name: /Adwoa Fabrics/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Flag as fraud' }))
    fireEvent.click(screen.getByRole('button', { name: 'Raise fraud case' }))
    expect(await screen.findByText('Fraud case raised. It is in Fraud cases.')).toBeInTheDocument()
    expect(body).toMatchObject({ kind: 'other', business_owner: 5 })
  })

  it('hides the actions the caller has no permission for', async () => {
    serve(() => payload([issue()]))
    renderPanel({ auth: auth(['service_issues.view']) })
    fireEvent.click(await screen.findByRole('button', { name: /Adwoa Fabrics/ }))
    const detail = await screen.findByRole('complementary')
    expect(within(detail).queryByRole('button')).not.toBeInTheDocument()
  })
})
