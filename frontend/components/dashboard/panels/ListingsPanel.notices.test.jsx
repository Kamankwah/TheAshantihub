import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../../mocks/server.js'
import ListingsPanel from './ListingsPanel.jsx'

const API = 'http://localhost:8000'
const row = (o) => ({ id: 1, name: 'Shea butter', status: 'draft', price_amount: '20.00', price_unit: 'per item', category: 2, photos: [], videos: [], variants: [], specs: [], ...o })

function renderWith(rows) {
  server.use(
    http.get(`${API}/api/listings/mine/`, () => HttpResponse.json(rows)),
    http.get(`${API}/api/hero/mine/`, () => HttpResponse.json({})),
  )
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><ListingsPanel user={{ fullName: 'Abena' }} businessKind={null} /></QueryClientProvider>)
}

describe('ListingsPanel server notices', () => {
  it('shows the calm hold line on a listing waiting for a check', async () => {
    renderWith([row({ status: 'pending_review', hold_notice: 'We need to check this listing.' })])
    expect(await screen.findByText('We need to check this listing.')).toBeInTheDocument()
  })

  it('lists what to fix on a draft or rejected listing sent back', async () => {
    renderWith([
      row({ id: 1, status: 'draft', fix_reasons: ['Add at least one photo.', 'Add a price.'] }),
      row({ id: 2, name: 'Sandals', status: 'rejected', rejection_reason: 'Blurry', fix_reasons: ['The description is too short.'] }),
    ])
    expect(await screen.findByText('Add at least one photo.')).toBeInTheDocument()
    expect(screen.getByText('Add a price.')).toBeInTheDocument()
    expect(screen.getByText('The description is too short.')).toBeInTheDocument()
    expect(screen.getAllByText('To fix before you submit again:')).toHaveLength(2)
  })

  it('shows nothing when the notices are null or empty', async () => {
    renderWith([row({ status: 'pending_review', hold_notice: null, fix_reasons: [] }), row({ id: 2, name: 'Plain', status: 'draft', fix_reasons: [] })])
    await screen.findByText('Plain')
    expect(screen.queryByText('We need to check this listing.')).not.toBeInTheDocument()
    expect(screen.queryByText(/To fix before you submit again/)).not.toBeInTheDocument()
  })
})
