import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../../../mocks/server.js'
import MyTeamPanel from '../MyTeamPanel.jsx'

const member = (id, name, status) => ({ id, full_name: name, email: `${id}@example.com`, phone: null, role: 'scout', manager: 2, manager_name: 'Ama', status, is_suspended: status === 'suspended', suspension_reason: '', is_active: true, permissions: [], role_permissions: [], created_at: '2026-10-01T00:00:00Z' })

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={queryClient}><MyTeamPanel /></QueryClientProvider>)
}

describe('MyTeamPanel', () => {
  it('invites someone to a role the server allows', async () => {
    let body = null
    server.use(
      http.get('http://localhost:8000/api/accounts/staff/invitable-roles/', () => HttpResponse.json(['scout', 'support'])),
      http.post('http://localhost:8000/api/accounts/staff/invite/', async ({ request }) => { body = await request.json(); return HttpResponse.json({ id: 9 }, { status: 201 }) }),
    )
    renderPanel()
    fireEvent.change(await screen.findByLabelText('Full name'), { target: { value: 'Kwame Asante' } })
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'kwame@example.com' } })
    await screen.findByRole('option', { name: 'Support' })
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'support' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send invite' }))
    await waitFor(() => expect(body).toEqual({ full_name: 'Kwame Asante', email: 'kwame@example.com', role: 'support' }))
  })

  it('resends a pending invite and suspends an active member', async () => {
    const calls = []
    server.use(
      http.get('http://localhost:8000/api/accounts/staff/team/', () => HttpResponse.json([member(5, 'Pending Person', 'invited'), member(6, 'Efua Mensah', 'active')])),
      http.post('http://localhost:8000/api/accounts/staff/5/resend-invite/', () => { calls.push('resend'); return HttpResponse.json({}) }),
      http.post('http://localhost:8000/api/accounts/staff/6/suspend/', async ({ request }) => { calls.push((await request.json()).reason); return HttpResponse.json({}) }),
    )
    renderPanel()
    fireEvent.click(await screen.findByRole('button', { name: 'Resend invite to Pending Person' }))
    fireEvent.change(screen.getByLabelText('Reason for suspending Efua Mensah'), { target: { value: 'Investigation' } })
    fireEvent.click(screen.getByRole('button', { name: 'Suspend Efua Mensah' }))
    await waitFor(() => expect(calls).toEqual(['resend', 'Investigation']))
  })
})
