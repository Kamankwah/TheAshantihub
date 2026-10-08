import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { apiPost } from '../../../apiClient.js'
import { server } from '../../../mocks/server.js'
import SudoPrompt from '../SudoPrompt.jsx'

const SUSPEND = 'http://localhost:8000/api/accounts/staff/9/suspend/'
const PERMISSIONS = 'http://localhost:8000/api/accounts/staff/9/permissions/'
const REAUTH = 'http://localhost:8000/api/accounts/staff/reauth/'
const needSudo = () => HttpResponse.json({ detail: 'Re-enter your password to continue.', code: 'sudo_required' }, { status: 403 })

describe('SudoPrompt', () => {
  it('asks for the password and retries the action once', async () => {
    let attempts = 0
    let reauth = null
    server.use(
      http.post(SUSPEND, () => { attempts += 1; return attempts === 1 ? needSudo() : HttpResponse.json({ id: 9, status: 'suspended' }) }),
      http.post(REAUTH, async ({ request }) => { reauth = await request.json(); return HttpResponse.json({ sudo_until: '2026-10-07T12:00:00Z' }) }),
    )
    render(<SudoPrompt />)
    const action = apiPost('/api/accounts/staff/9/suspend/', { reason: 'x' })
    fireEvent.change(await screen.findByLabelText('Password'), { target: { value: 'correct-horse-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await expect(action).resolves.toEqual({ id: 9, status: 'suspended' })
    expect(reauth).toEqual({ password: 'correct-horse-1' })
    expect(attempts).toBe(2)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('keeps the prompt open on a wrong password', async () => {
    server.use(
      http.post(SUSPEND, needSudo),
      http.post(REAUTH, () => HttpResponse.json({ password: ["That password isn't right."] }, { status: 400 })),
    )
    render(<SudoPrompt />)
    apiPost('/api/accounts/staff/9/suspend/', {}).catch(() => {})
    fireEvent.change(await screen.findByLabelText('Password'), { target: { value: 'wrong' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(await screen.findByRole('alert')).toHaveTextContent("That password isn't right.")
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('cancelling fails the action without retrying it', async () => {
    let attempts = 0
    server.use(http.post(SUSPEND, () => { attempts += 1; return needSudo() }))
    render(<SudoPrompt />)
    const action = apiPost('/api/accounts/staff/9/suspend/', {})
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    await expect(action).rejects.toMatchObject({ status: 403 })
    expect(attempts).toBe(1)
  })

  it('shows one prompt for two protected actions at once and retries both', async () => {
    let unlocked = false
    const calls = { suspend: 0, permissions: 0 }
    server.use(
      http.post(SUSPEND, () => { calls.suspend += 1; return unlocked ? HttpResponse.json({ ok: 'suspend' }) : needSudo() }),
      http.post(PERMISSIONS, () => { calls.permissions += 1; return unlocked ? HttpResponse.json({ ok: 'permissions' }) : needSudo() }),
      http.post(REAUTH, () => { unlocked = true; return HttpResponse.json({ sudo_until: 'later' }) }),
    )
    render(<SudoPrompt />)
    const both = Promise.all([
      apiPost('/api/accounts/staff/9/suspend/', {}),
      apiPost('/api/accounts/staff/9/permissions/', { grant: [], revoke: [] }),
    ])
    await waitFor(() => expect(calls.suspend + calls.permissions).toBe(2))
    expect(await screen.findAllByRole('dialog')).toHaveLength(1)
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct-horse-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await expect(both).resolves.toEqual([{ ok: 'suspend' }, { ok: 'permissions' }])
    expect(calls).toEqual({ suspend: 2, permissions: 2 })
  })
})

describe('SudoPrompt — edge cases', () => {
  it('after a wrong password, a correct one still unlocks and retries', async () => {
    let unlocked = false
    let tries = 0
    server.use(
      http.post(SUSPEND, () => (unlocked ? HttpResponse.json({ ok: true }) : needSudo())),
      http.post(REAUTH, async ({ request }) => {
        tries += 1
        const { password } = await request.json()
        if (password !== 'right') return HttpResponse.json({ password: ["That password isn't right."] }, { status: 400 })
        unlocked = true
        return HttpResponse.json({ sudo_until: 'later' })
      }),
    )
    render(<SudoPrompt />)
    const action = apiPost('/api/accounts/staff/9/suspend/', {})
    fireEvent.change(await screen.findByLabelText('Password'), { target: { value: 'nope' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'right' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await expect(action).resolves.toEqual({ ok: true })
    expect(tries).toBe(2)
  })

  it('does not loop when the retry is refused for needing the password again', async () => {
    let attempts = 0
    server.use(
      http.post(SUSPEND, () => { attempts += 1; return needSudo() }),
      http.post(REAUTH, () => HttpResponse.json({ sudo_until: 'later' })),
    )
    render(<SudoPrompt />)
    const action = apiPost('/api/accounts/staff/9/suspend/', {})
    fireEvent.change(await screen.findByLabelText('Password'), { target: { value: 'pw' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await expect(action).rejects.toMatchObject({ status: 403 })
    expect(attempts).toBe(2)
  })

  it('disables Confirm while the password is being checked, so it cannot be posted twice', async () => {
    let reauths = 0
    let release
    server.use(
      http.post(SUSPEND, needSudo),
      http.post(REAUTH, async () => { reauths += 1; await new Promise((r) => { release = r }); return HttpResponse.json({ password: ['no'] }, { status: 400 }) }),
    )
    render(<SudoPrompt />)
    apiPost('/api/accounts/staff/9/suspend/', {}).catch(() => {})
    fireEvent.change(await screen.findByLabelText('Password'), { target: { value: 'pw' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled())
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(reauths).toBe(1))
    release()
    await screen.findByRole('alert')
    expect(reauths).toBe(1)
  })

  it('unmounting while the prompt is open cancels the action and unregisters the handler', async () => {
    let attempts = 0
    server.use(http.post(SUSPEND, () => { attempts += 1; return needSudo() }))
    const { unmount } = render(<SudoPrompt />)
    const action = apiPost('/api/accounts/staff/9/suspend/', {})
    await screen.findByRole('dialog')
    unmount()
    await expect(action).rejects.toMatchObject({ status: 403 })
    await expect(apiPost('/api/accounts/staff/9/suspend/', {})).rejects.toMatchObject({ status: 403 })
    expect(attempts).toBe(2)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
