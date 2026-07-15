import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../mocks/server.js'
import { useListingQuestions } from '../useListingQuestions.js'

function renderWithClient(hook) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return renderHook(hook, {
    wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  })
}

describe('useListingQuestions', () => {
  it('returns the paginated question list', async () => {
    server.use(
      http.get('http://localhost:8000/api/qa/questions/listing/1/', () => {
        return HttpResponse.json({
          count: 1, next: null, previous: null,
          results: [{ id: 1, question_text: 'Does this come in blue?', answer_text: null, answered_at: null }],
        })
      }),
    )
    const { result } = renderWithClient(() => useListingQuestions(1))
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.data.results).toHaveLength(1)
    expect(result.current.data.results[0].question_text).toBe('Does this come in blue?')
  })

  it('exposes isError on failure', async () => {
    server.use(
      http.get('http://localhost:8000/api/qa/questions/listing/999/', () => new HttpResponse(null, { status: 404 })),
    )
    const { result } = renderWithClient(() => useListingQuestions(999))
    await waitFor(() => expect(result.current.isError).toBe(true))
  })

  it('is disabled when id is null', () => {
    const { result } = renderWithClient(() => useListingQuestions(null))
    expect(result.current.fetchStatus).toBe('idle')
  })
})
