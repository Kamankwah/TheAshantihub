import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { server } from '../../../../mocks/server.js'
import StaffActivityPanel, { eventDetail } from '../StaffActivityPanel.jsx'

const downloads = vi.hoisted(() => vi.fn())
vi.mock('../../../../apiClient.js', async (importOriginal) => ({ ...(await importOriginal()), apiDownload: downloads }))

const API = 'http://localhost:8000'
const event = (id, over = {}) => ({ id, occurred_at: '2026-10-07T11:40:00Z', actor_type: 'staff', actor_id: id, actor_role: 'scout', actor_label: 'Efua Mensah', verb: 'visit.check_in', method: 'POST', target_type: 'field.visitcheckin', target_id: '1', target_label: 'Kejetia block C', summary: '', before: null, after: { distance_m: 12, purpose: 'onboarding_photos', outside_radius: false }, ...over })

function serve({ events = [event(1)], chain = { checked: false }, seen = [] } = {}) {
  server.use(
    http.get(`${API}/api/activity/`, ({ request }) => { seen.push(Object.fromEntries(new URL(request.url).searchParams)); return HttpResponse.json({ count: events.length, next: null, previous: null, results: events }) }),
    http.get(`${API}/api/activity/people/`, () => HttpResponse.json([{ id: 1, name: 'Efua Mensah', role: 'scout' }, { id: 2, name: 'Akua Sarpong', role: 'marketing' }])),
    http.get(`${API}/api/activity/chain-status/`, () => HttpResponse.json(chain)),
  )
  return seen
}
function renderPanel(props = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}><StaffActivityPanel {...props} /></QueryClientProvider>)
}

describe('StaffActivityPanel', () => {
  beforeEach(() => downloads.mockReset().mockResolvedValue(null))

  it('lists who did what with the detail the event recorded, and marks a flagged check-in', async () => {
    serve({ events: [event(1), event(2, { actor_label: 'Yaw Owusu', target_label: 'Bonwire Kente Looms', after: { distance_m: 180, purpose: 'registration', outside_radius: true } })] })
    renderPanel()
    const flagged = (await screen.findByText('Bonwire Kente Looms')).closest('tr')
    expect(flagged).toHaveTextContent('Yaw Owusu')
    expect(flagged).toHaveTextContent('180 m from the pin — outside the radius, flagged')
    expect(screen.getByText('12 m from the pin · onboarding photos').closest('tr')).toHaveTextContent('Efua Mensah')
  })

  it('sends the filters to the server and returns to the first page', async () => {
    const seen = serve()
    renderPanel()
    await screen.findByText('Efua Mensah', { selector: 'span' })
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'scout' } })
    fireEvent.change(screen.getByLabelText('Action'), { target: { value: 'call' } })
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-10-01' } })
    await waitFor(() => expect(seen.at(-1)).toMatchObject({ role: 'scout', verb: 'call', since: '2026-10-01' }))
  })

  it('"Just me" asks for only my own actions', async () => {
    const seen = serve()
    renderPanel()
    await screen.findByLabelText('Role')
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'me' } })
    await waitFor(() => expect(seen.at(-1)).toMatchObject({ mine: '1' }))
    expect(seen.at(-1).role).toBeUndefined()
  })

  it('narrows the Person list to the chosen role', async () => {
    serve()
    renderPanel()
    const person = await screen.findByLabelText('Person')
    await waitFor(() => expect(within(person).getByText('Akua Sarpong')).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'scout' } })
    expect(within(screen.getByLabelText('Person')).queryByText('Akua Sarpong')).toBeNull()
    expect(within(screen.getByLabelText('Person')).getByText('Efua Mensah')).toBeInTheDocument()
  })

  it('exports the filtered view as CSV and as Excel', async () => {
    serve()
    renderPanel()
    await screen.findByLabelText('Role')
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'scout' } })
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }))
    await waitFor(() => expect(downloads).toHaveBeenCalledWith(expect.stringContaining('/api/activity/export/?'), 'ashantihub-staff-activity.csv'))
    expect(downloads.mock.calls[0][0]).toContain('role=scout')
    expect(downloads.mock.calls[0][0]).toContain('format=csv')
    fireEvent.click(screen.getByRole('button', { name: 'Export Excel' }))
    await waitFor(() => expect(downloads.mock.calls[1][0]).toContain('format=xlsx'))
  })

  it('says only "Checked nightly" until a check result is stored, then states the stored result', async () => {
    serve({ chain: { checked: false } })
    const first = renderPanel()
    expect(await screen.findByText(/Checked nightly\./)).toBeInTheDocument()
    expect(screen.queryByText(/intact/)).toBeNull()
    first.unmount()
    serve({ chain: { checked: true, checked_at: '2026-10-07T02:00:00Z', ok: true, events: 184 } })
    renderPanel()
    expect(await screen.findByText(/Last check of the whole chain: .*intact/)).toBeInTheDocument()
  })

  it('shows the live chip only when the socket is live, and the role scope explainer', async () => {
    serve()
    renderPanel({ live: true })
    expect(await screen.findByRole('status')).toHaveTextContent('Live')
    expect(screen.getByText(/Another Operations lead's actions are visible to Super Admin/)).toBeInTheDocument()
    expect(screen.getByText(/Every export you make from here is itself recorded/)).toBeInTheDocument()
  })

  it('shows an honest empty state', async () => {
    serve({ events: [] })
    renderPanel()
    expect(await screen.findByText('Nothing matches those filters.')).toBeInTheDocument()
  })
})

describe('eventDetail', () => {
  it('prefers the recorded summary and invents nothing for other events', () => {
    expect(eventDetail({ verb: 'x', summary: 'Did a thing', after: null })).toEqual({ text: 'Did a thing', flagged: false })
    expect(eventDetail({ verb: 'kyc-approve', summary: '', after: null })).toEqual({ text: '', flagged: false })
    expect(eventDetail({ verb: 'visit.check_out', summary: '', after: { minutes: 35 } }).text).toBe('35 min on site')
  })

  describe('as the Super Admin audit log', () => {
    const detailed = (id, over = {}) => event(id, { ip: '154.160.24.91', user_agent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/120.0 Safari/537.36', hash: '9f3c' + 'a'.repeat(56) + 'a41e', prev_hash: '51b0' + 'b'.repeat(56) + '7d2c', on_behalf_of_id: null, ...over })

    it('is titled Audit log, words the seal honestly and searches on the server', async () => {
      const seen = serve({ events: [detailed(1)], chain: { checked: true, checked_at: '2026-10-13T02:00:00Z', ok: true, events: 1284602, seal_emailed: false } })
      renderPanel({ superAdmin: true })
      expect(await screen.findByRole('heading', { name: 'Audit log' })).toBeInTheDocument()
      expect(await screen.findByText('Chain intact')).toBeInTheDocument()
      expect(await screen.findByText(/not emailed from this environment/)).toBeInTheDocument()
      expect(screen.queryByText(/sent off the server/)).not.toBeInTheDocument()
      fireEvent.change(screen.getByLabelText('Search the log'), { target: { value: 'Adwoa' } })
      await waitFor(() => expect(seen.at(-1)).toMatchObject({ q: 'Adwoa' }))
    })

    it('says the seal is emailed only where the server says so', async () => {
      serve({ events: [detailed(1)], chain: { checked: true, checked_at: '2026-10-13T02:00:00Z', ok: true, events: 10, seal_emailed: true } })
      renderPanel({ superAdmin: true })
      expect(await screen.findByText(/seal is emailed to every Super Admin/)).toBeInTheDocument()
    })

    it('shows device, address and a Done outcome, and opens the seal and before/after for a row', async () => {
      serve({ events: [detailed(1, { verb: 'targets.limits_set', before: { daily_visits: 8 }, after: { daily_visits: 10 }, summary: 'Changed the visit limit' })] })
      renderPanel({ superAdmin: true })
      const row = (await screen.findByText('Changed the visit limit')).closest('tr')
      expect(row).toHaveTextContent('Chrome on Windows computer · 154.160.24.91')
      expect(row).toHaveTextContent('Done')
      fireEvent.click(row)
      const detail = await screen.findByRole('region', { name: 'Entry detail' })
      expect(detail).toHaveTextContent('9f3c…a41e')
      expect(detail).toHaveTextContent('51b0…7d2c')
      expect(within(detail).getByText('daily_visits').closest('tr')).toHaveTextContent('810')
    })

    it('offers the System actor and all roles, and drops the Operations scope note', async () => {
      serve({ events: [detailed(1)] })
      renderPanel({ superAdmin: true })
      await screen.findByRole('heading', { name: 'Audit log' })
      expect(screen.getByRole('option', { name: 'System' })).toBeInTheDocument()
      expect(screen.getByRole('option', { name: 'Operations' })).toBeInTheDocument()
      expect(screen.queryByText('What Operations can see here')).not.toBeInTheDocument()
    })
  })
})
