import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../../../mocks/server.js'
import RolesPermissionsPanel from '../RolesPermissionsPanel.jsx'
import { API, renderPanel } from './saTestUtils.jsx'

const role = (name, label, people, extra = {}) => ({ name, label, locked: name === 'super_admin', people, grants: 0, revokes: 0, ...extra })
const MATRIX = {
  permission_count: 3,
  roles: [role('super_admin', 'Super Admin', 1), role('operations', 'Operations', 2, { revokes: 1 }), role('scout', 'Scout', 15, { grants: 1 })],
  groups: [
    { name: 'Businesses and listings', permissions: [{ codename: 'kyc.approve', description: 'Approve or reject KYC', roles: { super_admin: true, operations: true, scout: false }, locked_for: { super_admin: 'Super Admin always holds every permission.' } }] },
    { name: 'People and access', permissions: [
      { codename: 'orders.manage_delivery', description: 'Manage deliveries', roles: { super_admin: true, operations: false, scout: false }, locked_for: { super_admin: 'x' } },
      { codename: 'roles.manage', description: 'Change what each role can do', roles: { super_admin: true, operations: false, scout: false }, locked_for: { super_admin: 'x', operations: 'roles.manage stays with Super Admin (changing what roles can do).', scout: 'roles.manage stays with Super Admin (changing what roles can do).' } },
    ] },
  ],
}
const PREVIEW = {
  count: 2, people_affected: 17, exceptions: 1,
  changes: [
    { role: 'scout', role_label: 'Scout', permission: 'orders.manage_delivery', description: 'Manage deliveries', grant: true, people: 15, effect: 'Scout people can now: Manage deliveries. Kwame already had this as an individual grant; it becomes part of the role.', exceptions: [{ name: 'Kwame', kind: 'granted individually' }] },
    { role: 'operations', role_label: 'Operations', permission: 'kyc.approve', description: 'Approve or reject KYC', grant: false, people: 2, effect: 'Operations people can no longer: Approve or reject KYC.', exceptions: [] },
  ],
}

function setup() {
  const seen = { previews: [], saves: [] }
  server.use(
    http.get(`${API}/api/people/roles/`, () => HttpResponse.json(MATRIX)),
    http.post(`${API}/api/people/roles/preview/`, async ({ request }) => { seen.previews.push(await request.json()); return HttpResponse.json(PREVIEW) }),
    http.post(`${API}/api/people/roles/save/`, async ({ request }) => { seen.saves.push(await request.json()); return HttpResponse.json({ saved: 2, people_affected: 17 }) }),
  )
  return seen
}
const box = (label) => screen.getByRole('checkbox', { name: new RegExp(label) })

describe('RolesPermissionsPanel', () => {
  it('shows only permissions that exist, locks Super Admin and the protected ones with the reason', async () => {
    setup()
    renderPanel(<RolesPermissionsPanel />)
    const table = await screen.findByRole('table', { name: 'Role permissions' })
    expect(within(table).queryByText(/payouts\./)).toBeNull()
    expect(screen.getByText('3 permissions that exist today.', { exact: false })).toBeInTheDocument()
    expect(box('Super Admin: Approve or reject KYC')).toBeDisabled()
    const protectedBox = box('Operations: Change what each role can do')
    expect(protectedBox).toBeDisabled()
    expect(protectedBox).toHaveAttribute('title', expect.stringContaining('stays with Super Admin'))
    expect(box('Operations: Approve or reject KYC')).toBeChecked()
    expect(box('Scout: Approve or reject KYC')).not.toBeChecked()
    expect(within(table).getByText('1 grant')).toBeInTheDocument()
    expect(within(table).getByText('1 revoke')).toBeInTheDocument()
  })

  it('counts unsaved changes, undoing one removes it, and discard clears them', async () => {
    setup()
    renderPanel(<RolesPermissionsPanel />)
    await screen.findByRole('table', { name: 'Role permissions' })
    fireEvent.click(box('Scout: Manage deliveries'))
    expect(screen.getByRole('status')).toHaveTextContent('1 unsaved change')
    fireEvent.click(box('Scout: Manage deliveries'))
    expect(screen.queryByText(/unsaved change/)).toBeNull()
    fireEvent.click(box('Scout: Manage deliveries'))
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }))
    expect(box('Scout: Manage deliveries')).not.toBeChecked()
  })

  it('previews exactly what would change before saving, then saves', async () => {
    const seen = setup()
    renderPanel(<RolesPermissionsPanel />)
    await screen.findByRole('table', { name: 'Role permissions' })
    fireEvent.click(box('Scout: Manage deliveries'))
    fireEvent.click(box('Operations: Approve or reject KYC'))
    fireEvent.click(screen.getByRole('button', { name: 'Review and save' }))
    const preview = await screen.findByRole('region', { name: 'Before you save' })
    expect(seen.previews[0].changes).toEqual(expect.arrayContaining([
      { role: 'scout', permission: 'orders.manage_delivery', grant: true },
      { role: 'operations', permission: 'kyc.approve', grant: false },
    ]))
    expect(within(preview).getByText(/2 changes · 17 people affected/)).toBeInTheDocument()
    expect(within(preview).getByText(/Kwame already had this as an individual grant/)).toBeInTheDocument()
    expect(seen.saves).toHaveLength(0)
    fireEvent.click(within(preview).getByRole('button', { name: 'Save 2 changes' }))
    await waitFor(() => expect(seen.saves).toHaveLength(1))
    expect(await screen.findByText(/Saved 2 changes\. 17 people reconnected/)).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Before you save' })).toBeNull()
  })

  it('shows the server reason when a save is refused', async () => {
    setup()
    server.use(http.post(`${API}/api/people/roles/save/`, () => HttpResponse.json({ detail: 'Only the external co-signer can co-sign.' }, { status: 400 })))
    renderPanel(<RolesPermissionsPanel />)
    await screen.findByRole('table', { name: 'Role permissions' })
    fireEvent.click(box('Scout: Manage deliveries'))
    fireEvent.click(screen.getByRole('button', { name: 'Review and save' }))
    fireEvent.click(await screen.findByRole('button', { name: /Save \d+ change/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Only the external co-signer can co-sign.')
  })
})
