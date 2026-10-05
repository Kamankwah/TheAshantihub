import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import CreditPanel from './CreditPanel.jsx'
import { server } from '../../../mocks/server.js'

// Lending partners are a future add-on. Until one exists the Credit tab shows
// the real score and grade, says partners are coming soon, and never shows
// invented loan caps, partner counts or revenue/impact projections.

const SCORE = {
  score: 562, base_score: 562, manual_adjustment: 0, adjustment_reason: '', grade: 'C+',
  grade_label: 'Below Average', loan_eligible: false, factors: {}, computed_at: '2026-10-05T09:00:00Z',
}

function renderPanel({ partners = [] } = {}) {
  server.use(
    http.get('http://localhost:8000/api/credit/scores/me/', () => HttpResponse.json(SCORE)),
    http.get('http://localhost:8000/api/credit/partners/', () => HttpResponse.json(partners)),
  )
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}><CreditPanel user={{ fullName: 'Akosua Ntoma' }} /></QueryClientProvider>,
  )
}

const INVENTED = [/GHS 5M/, /GHS 100K/, /Referral Revenue/i, /All 6 partners/, /Economic Impact Projection/, /2,000,000/, /GHS 1B\+/]

function expectNoInventedFigures() {
  for (const pattern of INVENTED) expect(screen.queryByText(pattern)).not.toBeInTheDocument()
}

describe('CreditPanel without lending partners', () => {
  it('overview shows the real score but no invented loan cap or partner counts', async () => {
    renderPanel()
    expect((await screen.findAllByText('562')).length).toBeGreaterThan(0)
    expect(screen.queryByText(/GHS 5,000/)).not.toBeInTheDocument()
    expect(screen.queryByText(/\d+ partners/)).not.toBeInTheDocument() // e.g. "1–2 partners"
    expect(screen.getAllByText(/Lending partners are coming soon/i).length).toBeGreaterThan(0)
    expectNoInventedFigures()
  })

  it('the Lending Partners tab says partners are coming soon, with no revenue model', async () => {
    renderPanel()
    await screen.findAllByText('562')
    fireEvent.click(screen.getByRole('button', { name: /Lending Partners/ }))
    expect(screen.getAllByText(/Lending partners are coming soon/i).length).toBeGreaterThan(0)
    expectNoInventedFigures()
  })

  it('the Loan Application tab has no form until partners exist', async () => {
    renderPanel()
    await screen.findAllByText('562')
    fireEvent.click(screen.getByRole('button', { name: /Loan Application/ }))
    expect(screen.getAllByText(/Lending partners are coming soon/i).length).toBeGreaterThan(0)
    expect(screen.queryByPlaceholderText(/Max: GHS/)).not.toBeInTheDocument()
  })

  it('the Insights tab has no economic-impact projection', async () => {
    renderPanel()
    await screen.findAllByText('562')
    fireEvent.click(screen.getByRole('button', { name: /Insights/ }))
    expectNoInventedFigures()
  })
})
