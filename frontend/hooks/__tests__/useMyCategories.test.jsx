import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../mocks/server.js'
import { useMyCategories } from '../useMyCategories.js'

function renderWithClient(hook) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return renderHook(hook, {
    wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  })
}

describe('useMyCategories', () => {
  it('reads the endpoint', async () => {
    server.use(
      http.get('http://localhost:8000/api/accounts/business-owners/me/categories/', () => HttpResponse.json({
        business_kind: 'product', min: 1, max: 10,
        categories: [{ id: 5, label: 'Fashion', kind: 'product' }],
      })),
    )
    const { result } = renderWithClient(() => useMyCategories())
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.data.business_kind).toBe('product')
    expect(result.current.data.categories[0].label).toBe('Fashion')
  })

  it('answers an empty list by default', async () => {
    const { result } = renderWithClient(() => useMyCategories())
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.data).toEqual({ business_kind: 'product', min: 1, max: 10, categories: [] })
  })

  it('does not fetch while disabled', async () => {
    const { result } = renderWithClient(() => useMyCategories(false))
    expect(result.current.fetchStatus).toBe('idle')
  })
})
