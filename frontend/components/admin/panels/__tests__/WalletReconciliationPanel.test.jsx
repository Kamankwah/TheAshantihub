import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../../../mocks/server.js'
import WalletReconciliationPanel from '../WalletReconciliationPanel.jsx'

const API = 'http://localhost:8000/api/wallet/staff/reconciliation/'
const wrap = (ui) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>)
const run = (over = {}) => ({
  day: '2026-10-19', provider: 'hubtel', status: 'matched', status_label: 'Matched', ledger_in: '100.00', statement_in: '100.00',
  ledger_out: '40.00', statement_out: '40.00', in_transit: '5.00', in_transit_note: 'One payout sent late on the day', unavailable_checks: [],
  statement_source: 'Simulated provider statement (not a bank statement)', differences: {}, fraud_case_id: null, ran_at: '2026-10-20T01:00:00Z', ...over,
})
const serve = (results) => server.use(http.get(API, () => HttpResponse.json({ results })))

describe('Wallet reconciliation', () => {
  it('test_runs_listed_newest_first_with_ledger_and_statement_figures', async () => {
    serve([run({ day: '2026-10-19' }), run({ day: '2026-10-18', ledger_in: '70.00', statement_in: '69.00' })])
    wrap(<WalletReconciliationPanel fallback={<div>stub</div>} />)
    const items = await screen.findAllByRole('listitem')
    expect(items[0]).toHaveTextContent('2026-10-19')
    expect(items[1]).toHaveTextContent('2026-10-18')
    expect(items[0]).toHaveTextContent('Matched')
    expect(items[0]).toHaveTextContent('Ledger in')
    expect(items[1]).toHaveTextContent('GH₵ 70.00')
    expect(items[1]).toHaveTextContent('GH₵ 69.00')
    expect(items[0]).toHaveTextContent('In transit')
    expect(items[0]).toHaveTextContent('GH₵ 5.00')
    expect(items[0]).toHaveTextContent('One payout sent late on the day')
  })

  it('test_simulated_source_is_always_stated', async () => {
    serve([run(), run({ day: '2026-10-18' })])
    wrap(<WalletReconciliationPanel fallback={null} />)
    expect(await screen.findAllByText(/Simulated provider statement \(not a bank statement\)/)).toHaveLength(2)
  })

  it('test_unavailable_checks_are_listed_not_hidden', async () => {
    serve([run({ unavailable_checks: ['provider fees', 'refunds'] })])
    wrap(<WalletReconciliationPanel fallback={null} />)
    expect(await screen.findByText('Not checked: provider fees, refunds')).toBeInTheDocument()
  })

  it('test_differences_render_as_sent', async () => {
    serve([run({ status: 'differs', status_label: 'Differs', differences: { in: '1.00', missing_references: ['WD-1', 'WD-2'] }, fraud_case_id: 31 })])
    wrap(<WalletReconciliationPanel fallback={null} />)
    const item = (await screen.findByText('Differs')).closest('li')
    expect(item).toHaveTextContent('in')
    expect(item).toHaveTextContent('1.00')
    expect(item).toHaveTextContent('missing_references')
    expect(item).toHaveTextContent('WD-1')
    expect(item).toHaveTextContent('WD-2')
    expect(item).toHaveTextContent('Fraud case #31')
  })

  it('test_ledger_off_renders_the_fallback_stub', async () => {
    server.use(http.get(API, () => HttpResponse.json({ detail: 'off', code: 'ledger_off' }, { status: 409 })))
    wrap(<WalletReconciliationPanel fallback={<div>stub panel</div>} />)
    expect(await screen.findByText('stub panel')).toBeInTheDocument()
  })

  it('test_empty_and_refresh', async () => {
    let calls = 0
    server.use(http.get(API, () => { calls += 1; return HttpResponse.json({ results: [] }) }))
    wrap(<WalletReconciliationPanel fallback={null} />)
    expect(await screen.findByText('No reconciliation runs yet.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => expect(calls).toBe(2))
  })
})
