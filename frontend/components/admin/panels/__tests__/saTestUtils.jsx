import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'

export const API = 'http://localhost:8000'
export const SA = {
  user: { id: 1, full_name: 'Simon Peter', role: 'super_admin', account_type: 'staff' },
  hasPermission: () => true,
}
export const page = (results, extra = {}) => ({ count: results.length, next: null, previous: null, results, ...extra })
export const param = (url, key) => new URL(url).searchParams.get(key)

export function renderPanel(element) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{element}</QueryClientProvider>)
}
