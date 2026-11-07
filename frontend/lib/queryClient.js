import { QueryClient } from '@tanstack/react-query'

// A 4xx answer is a decision, not a glitch: retrying a 401/403/404/422 only repeats the refusal (and 429
// makes it worse). Network errors and 5xx get up to two quick retries.
export function shouldRetry(failureCount, error) {
  const status = error?.status
  if (typeof status === 'number' && status >= 400 && status < 500) return false
  return failureCount < 2
}

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000, // reads are reused for 30 s; writes invalidate their keys explicitly
        retry: shouldRetry,
      },
      mutations: { retry: false }, // a money/stock POST is never silently replayed (see request_id idempotency)
    },
  })
}
