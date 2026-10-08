import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { apiPost } from '../../../apiClient.js'
import { server } from '../../../mocks/server.js'
import AdminCommandCenter from '../AdminCommandCenter.jsx'

const SUSPEND = 'http://localhost:8000/api/accounts/staff/9/suspend/'
const needSudo = () => HttpResponse.json({ detail: 'Re-enter your password to continue.', code: 'sudo_required' }, { status: 403 })
const auth = {
  user: { token: 't', account_type: 'staff', id: 1, full_name: 'Akosua Support', role: 'support', permissions: ['messaging.manage'] },
  hasPermission: (c) => c === 'messaging.manage',
  logout: vi.fn(),
}

function renderShell() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}><AdminCommandCenter auth={auth} onExit={() => {}} /></QueryClientProvider>)
}

describe('AdminCommandCenter — password prompt', () => {
  it('mounts the prompt once: two protected calls show one dialog; it unregisters when the shell unmounts', async () => {
    server.use(http.post(SUSPEND, needSudo))
    const { unmount } = renderShell()
    const first = apiPost('/api/accounts/staff/9/suspend/', {})
    const second = apiPost('/api/accounts/staff/9/suspend/', {})
    expect(await screen.findAllByRole('dialog')).toHaveLength(1)
    unmount()
    await expect(first).rejects.toMatchObject({ status: 403 })
    await expect(second).rejects.toMatchObject({ status: 403 })
    // Handler is gone: a further 403 surfaces straight away, with no prompt.
    await expect(apiPost('/api/accounts/staff/9/suspend/', {})).rejects.toMatchObject({ status: 403 })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
