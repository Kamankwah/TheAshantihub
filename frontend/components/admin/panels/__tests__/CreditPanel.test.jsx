import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../../../mocks/server.js'
import CreditPanel from '../CreditPanel.jsx'

const API = 'http://localhost:8000'

describe('Admin CreditPanel factor labels', () => {
  it('labels the identity factor "Identity verified", not KYC', async () => {
    server.use(
      http.get(`${API}/api/credit/scores/`, () => HttpResponse.json([{
        business_owner: 3, business_owner_name: 'Adwoa Fabrics', base_score: 640, manual_adjustment: 0, score: 640,
        factors: { kyc_verified: { value: true, score_pct: 100, weight: 0.2 } },
      }])),
      http.get(`${API}/api/credit/partners/`, () => HttpResponse.json([])),
      http.get(`${API}/api/credit/loans/`, () => HttpResponse.json([])),
    )
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={queryClient}><CreditPanel /></QueryClientProvider>)
    expect(await screen.findByText('Identity verified: yes')).toBeInTheDocument()
    expect(screen.queryByText(/KYC verified/)).not.toBeInTheDocument()
  })
})
