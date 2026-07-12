import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../mocks/server.js'
import { useKYCQueue } from '../useKYCQueue.js'

function renderWithClient(hook) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return renderHook(hook, {
    wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  })
}

describe('useKYCQueue', () => {
  it('returns the pending KYC queue as a plain array', async () => {
    server.use(
      http.get('http://localhost:8000/api/accounts/kyc/pending/', () => {
        return HttpResponse.json([{ id: 1, full_name: 'Kwame Business', kyc_status: 'pending' }])
      }),
    )
    const { result } = renderWithClient(() => useKYCQueue())
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.data).toHaveLength(1)
  })

  it('exposes isError on failure', async () => {
    server.use(
      http.get('http://localhost:8000/api/accounts/kyc/pending/', () => new HttpResponse(null, { status: 403 })),
    )
    const { result } = renderWithClient(() => useKYCQueue())
    await waitFor(() => expect(result.current.isError).toBe(true))
  })
})
