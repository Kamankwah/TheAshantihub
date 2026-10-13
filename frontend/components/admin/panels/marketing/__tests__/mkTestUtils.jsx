import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'

export const API = 'http://localhost:8000'

// Mounts a Marketing panel with a fresh query cache, as a staff member holding `permissions`.
export function renderMk(Panel, { permissions = [], props = {} } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const auth = { user: { role: 'marketing', full_name: 'Akua Sarpong' }, hasPermission: (c) => permissions.includes(c) }
  return render(<QueryClientProvider client={queryClient}><Panel auth={auth} {...props} /></QueryClientProvider>)
}
