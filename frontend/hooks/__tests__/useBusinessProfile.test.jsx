import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../mocks/server.js'
import { useBusinessProfile } from '../useBusinessProfile.js'

function renderWithClient(hook) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return renderHook(hook, {
    wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  })
}

describe('useBusinessProfile', () => {
  it('returns the business owner profile', async () => {
    server.use(
      http.get('http://localhost:8000/api/accounts/business-owners/me/profile/', () => {
        return HttpResponse.json({ gps_address: 'Adum, Kumasi', is_formal: false })
      }),
    )
    const { result } = renderWithClient(() => useBusinessProfile())
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.data.gps_address).toBe('Adum, Kumasi')
  })

  it('exposes isError on failure', async () => {
    server.use(
      http.get('http://localhost:8000/api/accounts/business-owners/me/profile/', () => new HttpResponse(null, { status: 403 })),
    )
    const { result } = renderWithClient(() => useBusinessProfile())
    await waitFor(() => expect(result.current.isError).toBe(true))
  })
})
