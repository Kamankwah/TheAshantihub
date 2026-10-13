import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { server } from '../../../../mocks/server.js'
import ApprovalRulesPanel from '../ApprovalRulesPanel.jsx'

const API = 'http://localhost:8000'
const RULES = {
  settings: {
    cosign_threshold: '20000.00', refund_threshold: '500.00', campaign_threshold: '25.00', remind_fraction: '0.75',
    updated_at: null, updated_by: null, defaults: {},
  },
  kinds: [
    { key: 'commission.policy', label: 'Change a commission amount', chain: ['Super Admin only'], response_hours: 48, default_hours: 48, overridden: false, requires_sudo: false, has_amount: false },
    { key: 'business.kyc', label: 'Approve a business', chain: ["The maker's manager", 'Any Operations', 'Super Admin'], response_hours: 24, default_hours: 24, overridden: false, requires_sudo: true, has_amount: true },
  ],
  cosigners: [], cosigner_named: false, cosigner_invites_pending: 0, waiting_for_cosigner: 0,
}
function renderPanel(rules = RULES, props = {}) {
  server.use(http.get(`${API}/api/approvals/rules/`, () => HttpResponse.json(rules)))
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={queryClient}><ApprovalRulesPanel {...props} /></QueryClientProvider>)
}

describe('ApprovalRulesPanel', () => {
  it('shows the limits, each kind with its chain, and says plainly that no co-signer is named', async () => {
    renderPanel()
    expect(await screen.findByLabelText('Two approvers above (GH₵)')).toHaveValue('20000.00')
    expect(screen.getByText('Co-signer: not named yet')).toBeInTheDocument()
    expect(screen.getByText(/can't be released until a co-signer is named/)).toBeInTheDocument()
    expect(screen.getByText("The maker's manager → Any Operations → Super Admin")).toBeInTheDocument()
    expect(screen.getByText('Super Admin only')).toBeInTheDocument()
    expect(screen.getByLabelText('Response time for Change a commission amount (hours)')).toHaveValue('48')
    expect(screen.getByText('Nothing has been changed yet: these are the original values.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled()
  })

  it('names the co-signer when there is one and counts requests waiting on them', async () => {
    renderPanel({ ...RULES, cosigners: [{ id: 5, full_name: 'Nii Ext', email: 'nii@example.com' }], cosigner_named: true, waiting_for_cosigner: 2 })
    expect(await screen.findByText('Co-signer: Nii Ext')).toBeInTheDocument()
    expect(screen.getByText(/2 requests are waiting on a co-signer now/)).toBeInTheDocument()
  })

  it('sends only what changed, then shows the saved notice', async () => {
    let sent = null
    renderPanel()
    server.use(http.patch(`${API}/api/approvals/rules/`, async ({ request }) => { sent = await request.json(); return HttpResponse.json(RULES) }))
    fireEvent.change(await screen.findByLabelText('Two approvers above (GH₵)'), { target: { value: '30,000.00' } })
    fireEvent.change(screen.getByLabelText('Response time for Approve a business (hours)'), { target: { value: '6' } })
    fireEvent.change(screen.getByRole('combobox', { name: /Remind the approver at/ }), { target: { value: '0.50' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByText('Saved and recorded in the audit log.')).toBeInTheDocument()
    expect(sent).toEqual({ cosign_threshold: '30000.00', remind_fraction: '0.50', kinds: { 'business.kyc': '6' } })
  })

  it('shows the server refusal and keeps the edit', async () => {
    renderPanel()
    server.use(http.patch(`${API}/api/approvals/rules/`, () => HttpResponse.json({ kinds: { 'business.kyc': 'Use a whole number of hours from 1 to 720.' } }, { status: 400 })))
    fireEvent.change(await screen.findByLabelText('Response time for Approve a business (hours)'), { target: { value: '0' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.getByLabelText('Response time for Approve a business (hours)')).toHaveValue('0')
  })

  it('discard restores the saved values', async () => {
    renderPanel()
    const input = await screen.findByLabelText('Two approvers above (GH₵)')
    fireEvent.change(input, { target: { value: '99' } })
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    await waitFor(() => expect(screen.getByLabelText('Two approvers above (GH₵)')).toHaveValue('20000.00'))
  })

  it('offers the invite flow for a co-signer', async () => {
    const onNavigate = vi.fn()
    renderPanel(RULES, { onNavigate })
    fireEvent.click(await screen.findByRole('button', { name: 'Invite a co-signer' }))
    expect(onNavigate).toHaveBeenCalledWith('invites')
  })

  it('says so when the rules cannot be loaded', async () => {
    server.use(http.get(`${API}/api/approvals/rules/`, () => HttpResponse.json({ detail: 'no' }, { status: 403 })))
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={queryClient}><ApprovalRulesPanel /></QueryClientProvider>)
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the approval rules.')
    expect(within(document.body).queryByText('Money limits')).not.toBeInTheDocument()
  })
})
