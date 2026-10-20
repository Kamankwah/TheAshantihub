import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../mocks/server.js'
import { apiPost } from '../../apiClient.js'
import { useBusinessDetailChanges } from '../useBusinessDetailChanges.js'

const URL = 'http://localhost:8000/api/accounts/business-owners/me/detail-changes/'
const ROW = { id: 1, field: 'email', field_label: 'Email', new_value: 'ko•••@x.com', status: 'requested', can_withdraw: true }

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const rendered = renderHook(() => useBusinessDetailChanges(), {
    wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  })
  return { ...rendered, queryClient }
}

describe('useBusinessDetailChanges', () => {
  it('lists requests as a plain array', async () => {
    server.use(http.get(URL, () => HttpResponse.json({ results: [ROW] })))
    const { result } = setup()
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual([ROW])
  })

  it('posts a request and refetches', async () => {
    let rows = []
    let posted = null
    server.use(
      http.get(URL, () => HttpResponse.json({ results: rows })),
      http.post(URL, async ({ request }) => { posted = await request.json(); rows = [ROW]; return HttpResponse.json(ROW, { status: 201 }) }),
    )
    const { result, queryClient } = setup()
    await waitFor(() => expect(result.current.data).toEqual([]))
    await apiPost('/api/accounts/business-owners/me/detail-changes/', { field: 'email', new_value: 'k@x.com', reason: 'moved' })
    await queryClient.invalidateQueries({ queryKey: ['business-detail-changes'] })
    await waitFor(() => expect(result.current.data).toEqual([ROW]))
    expect(posted).toEqual({ field: 'email', new_value: 'k@x.com', reason: 'moved' })
  })

  it('withdraws', async () => {
    let rows = [ROW]
    server.use(
      http.get(URL, () => HttpResponse.json({ results: rows })),
      http.post(`${URL}1/withdraw/`, () => { rows = [{ ...ROW, status: 'withdrawn', can_withdraw: false }]; return HttpResponse.json(rows[0]) }),
    )
    const { result, queryClient } = setup()
    await waitFor(() => expect(result.current.data).toHaveLength(1))
    await apiPost('/api/accounts/business-owners/me/detail-changes/1/withdraw/', {})
    await queryClient.invalidateQueries({ queryKey: ['business-detail-changes'] })
    await waitFor(() => expect(result.current.data[0].status).toBe('withdrawn'))
  })
})
