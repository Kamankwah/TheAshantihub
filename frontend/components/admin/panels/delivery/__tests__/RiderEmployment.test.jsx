import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { server } from '../../../../../mocks/server.js'
import Riders from '../RidersPanel.jsx'
import RiderEmploymentSection from '../RiderEmploymentSection.jsx'

const API = 'http://localhost:8000'
const wrap = (ui) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>)
const own = { employment: 'ashantihub', employment_label: "AshantiHub's own rider", company_name: '', third_party_since: null, wallet: false, pending: null }
const third = { employment: 'third_party', employment_label: 'Third-party rider', company_name: 'Swift Riders', third_party_since: '2026-09-02T08:00:00Z', wallet: true, pending: null }
const pending = { ...own, pending: { approval_id: 41, employment: 'third_party', company_name: 'Swift Riders', proposed_by: 'Adwoa Sarpong', created_at: '2026-10-20T09:00:00Z' } }

function capture(status = 201, body = { approval_id: 7, status: 'pending', employment: 'third_party' }) {
  const seen = []
  server.use(http.post(`${API}/api/delivery/riders/9/employment/`, async ({ request }) => {
    seen.push(await request.json())
    return HttpResponse.json(body, { status })
  }))
  return seen
}
const show = (employment, onDone = () => {}) => wrap(<RiderEmploymentSection riderId={9} employment={employment} onDone={onDone} />)
const pickThird = () => fireEvent.click(screen.getByRole('radio', { name: 'Third-party rider (from a rider company)' }))
const send = () => screen.getByRole('button', { name: 'Send for approval' })

describe('RiderEmploymentSection', () => {
  it('shows who the rider works for and the company', () => {
    show(third)
    expect(screen.getByText(/Works for: Third-party rider/)).toBeInTheDocument()
    expect(screen.getByText(/Rider company: Swift Riders/)).toBeInTheDocument()
    expect(screen.getByText(/Third-party since/)).toBeInTheDocument()
  })

  it('shows a pending change and hides the form', () => {
    show(pending)
    expect(screen.getByText(/Waiting for a Super Admin: Third-party rider \(Swift Riders\) proposed by Adwoa Sarpong on .* \(request A-41\)\./)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Send for approval' })).toBeNull()
  })

  it('third party needs a company name before sending', () => {
    show(own)
    pickThird()
    expect(send()).toBeDisabled()
    const box = screen.getByLabelText('Rider company name')
    fireEvent.change(box, { target: { value: ' a ' } })
    expect(send()).toBeDisabled()
    fireEvent.change(box, { target: { value: 'Swift Riders' } })
    expect(send()).toBeEnabled()
    fireEvent.change(box, { target: { value: 'x'.repeat(121) } })
    expect(send()).toBeDisabled()
  })

  it('sends employment, company_name and note', async () => {
    const seen = capture()
    const onDone = vi.fn()
    show(own, onDone)
    pickThird()
    fireEvent.change(screen.getByLabelText('Rider company name'), { target: { value: ' Swift Riders ' } })
    fireEvent.change(screen.getByLabelText('Note (optional)'), { target: { value: 'Contract signed' } })
    fireEvent.click(send())
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(seen).toEqual([{ employment: 'third_party', company_name: 'Swift Riders', note: 'Contract signed' }])
  })

  it('switching back sends no company name', async () => {
    const seen = capture(201, { approval_id: 8, status: 'pending', employment: 'ashantihub' })
    show(third)
    fireEvent.click(screen.getByRole('radio', { name: "AshantiHub's own rider" }))
    expect(screen.queryByLabelText('Rider company name')).toBeNull()
    fireEvent.click(send())
    await screen.findByText(/Sent for approval/)
    expect(seen).toHaveLength(1)
    expect(seen[0]).not.toHaveProperty('company_name')
    expect(seen[0].employment).toBe('ashantihub')
  })

  it('a pending answer says it waits for a Super Admin', async () => {
    capture()
    show(own)
    pickThird()
    fireEvent.change(screen.getByLabelText('Rider company name'), { target: { value: 'Swift Riders' } })
    fireEvent.click(send())
    expect(await screen.findByText('Sent for approval (A-7). A Super Admin approves it with their password.')).toBeInTheDocument()
  })

  it("a Super Admin's own change says it applied", async () => {
    capture(201, { approval_id: 7, status: 'approved', employment: 'third_party' })
    const onDone = vi.fn()
    show(own, onDone)
    pickThird()
    fireEvent.change(screen.getByLabelText('Rider company name'), { target: { value: 'Swift Riders' } })
    fireEvent.click(send())
    expect(await screen.findByText('Applied.')).toBeInTheDocument()
    expect(onDone).toHaveBeenCalled()
  })

  it("rider_money_open shows the server's text", async () => {
    const detail = 'Money is still open for this rider: a withdrawal is waiting.'
    capture(409, { code: 'rider_money_open', detail, open: ['withdrawals'] })
    show(third)
    fireEvent.click(screen.getByRole('radio', { name: "AshantiHub's own rider" }))
    fireEvent.click(send())
    expect(await screen.findByText(detail)).toBeInTheDocument()
  })
})

describe('Rider profile employment', () => {
  const profile = (employment) => ({
    rider: { id: 9, status: 'on_shift', status_label: 'Free', vehicle_type: 'motorbike', home_zone: null, jobs_today: 0, delivered_today: 0, on_time_30d: { on_time: 0, of: 0 }, acceptance_30d: { accepted: 0, of: 0 }, delivered_30d: 0, could_not_deliver_30d: 0, cash_held: null, location: null, papers: { missing: [], expiring: 0, expired: 0, waiting: 0 }, job_hold: false, suspended: false },
    staff: { id: 4, full_name: 'Kofi Appiah', manager: null, phone: '' },
    documents: [], recent_jobs: [], devices: [], vehicle: null, ...(employment === undefined ? {} : { employment }),
  })
  const open = (employment) => {
    server.use(
      http.get(`${API}/api/delivery/zones/`, () => HttpResponse.json({ results: [] })),
      http.get(`${API}/api/delivery/riders/9/`, () => HttpResponse.json(profile(employment))),
    )
    wrap(<Riders detailId={9} onOpenDetail={() => {}} onNavigate={() => {}} />)
  }

  it('the pay section says wallet deliveries are not in payroll for a third-party rider', async () => {
    open(third)
    expect(await screen.findByText(/This rider is a third-party rider\. Deliveries on orders paid through the wallet ledger are paid into their AshantiHub wallet when Support confirms the order, and Rider payouts does not count them\./)).toBeInTheDocument()
    expect(screen.getByText(/Works for: Third-party rider/)).toBeInTheDocument()
  })

  it('no section when the profile has no employment block', async () => {
    open(undefined)
    await screen.findByRole('heading', { name: 'Pay' })
    expect(screen.queryByText(/Works for/)).toBeNull()
    expect(screen.queryByText(/third-party rider\./)).toBeNull()
  })
})
