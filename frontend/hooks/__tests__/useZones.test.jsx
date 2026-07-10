import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../mocks/server.js'
import { useZones } from '../useZones.js'

function renderWithClient(hook) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })
  return renderHook(hook, {
    wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  })
}

describe('useZones', () => {
  it('returns the zones list on success', async () => {
    server.use(
      http.get('http://localhost:8000/api/listings/zones/', () => {
        return HttpResponse.json([
          { id: 1, name: 'Manhyia' },
          { id: 2, name: 'Adum' },
        ])
      }),
    )
    const { result } = renderWithClient(() => useZones())
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.data).toHaveLength(2)
    expect(result.current.data[0].name).toBe('Manhyia')
  })
})
