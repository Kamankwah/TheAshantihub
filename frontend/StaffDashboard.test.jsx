import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { StaffDashboard } from './App.jsx'

function makeAuth(overrides = {}) {
  return {
    user: {
      token: 't', account_type: 'staff', id: 1, full_name: 'Akosua Support',
      role: 'support', permissions: ['messaging.manage', 'disputes.flag', 'users.view'],
    },
    hasPermission: (codename) => ['messaging.manage', 'disputes.flag', 'users.view'].includes(codename),
    ...overrides,
  }
}

describe('StaffDashboard', () => {
  it('shows Overview by default with a greeting and the session permissions', () => {
    render(<StaffDashboard auth={makeAuth()} onExit={vi.fn()} />)
    expect(screen.getByText(/Akwaaba, Akosua/)).toBeInTheDocument()
    expect(screen.getByText('messaging.manage')).toBeInTheDocument()
  })

  it('only shows nav items the session has permission for', () => {
    render(<StaffDashboard auth={makeAuth()} onExit={vi.fn()} />)
    expect(screen.getByText('Messaging / Tickets')).toBeInTheDocument()
    expect(screen.getByText('Users')).toBeInTheDocument()
    expect(screen.queryByText('KYC Queue')).not.toBeInTheDocument()
    expect(screen.queryByText('Staff Management')).not.toBeInTheDocument()
  })

  it('a super_admin-shaped session sees every nav item', () => {
    const auth = makeAuth({
      user: { token: 't', account_type: 'staff', id: 2, full_name: 'Kwame Super', role: 'super_admin', permissions: [
        'kyc.approve', 'listings.moderate', 'users.view', 'escrow.view', 'escrow.release',
        'disputes.resolve_financial', 'transactions.report', 'promotions.manage', 'analytics.view',
        'categories.manage', 'messaging.manage', 'disputes.flag', 'staff.manage', 'zones.manage',
      ] },
      hasPermission: () => true,
    })
    render(<StaffDashboard auth={auth} onExit={vi.fn()} />)
    ;['KYC Queue', 'Listings Moderation', 'Users', 'Categories & Zones', 'Staff Management',
      'Escrow Ledger', 'Disputes', 'Transactions Report', 'Promotions', 'Analytics', 'Messaging / Tickets']
      .forEach((label) => expect(screen.getByText(label)).toBeInTheDocument())
  })

  it('switches panels on nav click and shows a coming-soon message for unbuilt permissions', () => {
    render(<StaffDashboard auth={makeAuth()} onExit={vi.fn()} />)
    fireEvent.click(screen.getByText('Messaging / Tickets'))
    expect(screen.getByText(/coming soon/i)).toBeInTheDocument()
  })

  it('calls onExit when the exit button is clicked', () => {
    const onExit = vi.fn()
    render(<StaffDashboard auth={makeAuth()} onExit={onExit} />)
    fireEvent.click(screen.getByText('← Exit'))
    expect(onExit).toHaveBeenCalled()
  })

  it('toggles theme when the theme button is clicked', () => {
    render(<StaffDashboard auth={makeAuth()} onExit={vi.fn()} />)
    const toggle = screen.getByTitle('Toggle theme')
    expect(toggle.textContent).toBe('🌙')
    fireEvent.click(toggle)
    expect(toggle.textContent).toBe('☀️')
  })
})
