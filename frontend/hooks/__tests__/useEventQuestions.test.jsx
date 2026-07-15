import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../mocks/server.js'
import { useEventQuestions } from '../useEventQuestions.js'

function renderWithClient(hook) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return renderHook(hook, {
    wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  })
}

describe('useEventQuestions', () => {
  it('returns the paginated question list', async () => {
    server.use(
      http.get('http://localhost:8000/api/qa/questions/event/1/', () => {
        return HttpResponse.json({
          count: 1, next: null, previous: null,
          results: [{ id: 1, question_text: 'Is parking available?', answer_text: 'Yes, free parking.', answered_at: '2026-07-01T00:00:00Z' }],
        })
      }),
    )
    const { result } = renderWithClient(() => useEventQuestions(1))
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.data.results).toHaveLength(1)
    expect(result.current.data.results[0].answer_text).toBe('Yes, free parking.')
  })

  it('exposes isError on failure', async () => {
    server.use(
      http.get('http://localhost:8000/api/qa/questions/event/999/', () => new HttpResponse(null, { status: 404 })),
    )
    const { result } = renderWithClient(() => useEventQuestions(999))
    await waitFor(() => expect(result.current.isError).toBe(true))
  })

  it('is disabled when id is null', () => {
    const { result } = renderWithClient(() => useEventQuestions(null))
    expect(result.current.fetchStatus).toBe('idle')
  })
})
