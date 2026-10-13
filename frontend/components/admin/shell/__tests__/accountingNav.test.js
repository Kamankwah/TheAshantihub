import { describe, expect, it } from 'vitest'
import { BADGE_KEY_BY_TAB, NAV_ITEMS, PLACEHOLDER_TABS, buildNavGroups } from '../navModel.js'
import { ACCOUNTING_SHELLS } from '../../panels/AccountingShellPanel.jsx'
import { STEP_IN_TEAMS, isRebuiltRole } from '../../stepin/teams.js'

const accountant = (perms) => ({ user: { role: 'accountant' }, hasPermission: (c) => (perms === 'all' ? true : perms.includes(c)) })

describe('the Accounting menu (canvas 2026-10-07, 31 screens)', () => {
  const groups = buildNavGroups(accountant('all'))
  const labels = (id) => groups.find((g) => g.id === id).items.map((i) => i.label)

  it('has the canvas groups and items in order, with Disputes and the rest under More tools', () => {
    expect(groups.map((g) => [g.label, g.items.map((i) => i.label)])).toEqual([
      ['Decisions', ['Approvals']],
      ['Ledger', ['Journal', 'Chart of accounts', 'Trial balance']],
      ['Money in', ['Collections', 'Escrow']],
      ['Money out', ['Payout runs', 'Seller settlements', 'Rider payouts', 'Refunds']],
      ['People', ['Payroll', 'Commissions', 'Pay profiles']],
      ['Tax', ['PAYE', 'SSNIT & Tier 2', 'Withholding tax', 'VAT, NHIL, GETFund', 'Tax settings']],
      ['Controls', ['Reconciliation', 'Period close', 'Audit chain', 'Alerts']],
      ['Plans & pricing', ['Subscription Plans', 'Event Pricing', 'Credit & lending']],
      ['Reports', ['Statements', 'My reports']],
      ['More tools', expect.arrayContaining(['Disputes', 'Transactions Report', 'Commission policy', 'Tasks', 'Activity', 'Sign-in & Security'])],
    ])
    expect(labels('controls')).toHaveLength(4)
  })

  it('is real, not placeholders: every shell has a config and states what is missing', () => {
    expect([...PLACEHOLDER_TABS.accountant]).toEqual([])
    const shellIds = NAV_ITEMS.filter((i) => i.id.startsWith('acct-')).map((i) => i.id)
    const built = ['acct-collections', 'acct-audit-chain', 'acct-alerts', 'acct-statements']
    for (const id of shellIds.filter((id) => !built.includes(id))) {
      expect(ACCOUNTING_SHELLS[id], id).toBeTruthy()
      expect(ACCOUNTING_SHELLS[id].items.length, id).toBeGreaterThan(0)
    }
    expect(Object.keys(ACCOUNTING_SHELLS)).toHaveLength(14)
  })

  it('shows the Accounting screens to the Accountant only, with the money permission', () => {
    for (const role of ['super_admin', 'operations', 'marketing', 'support', 'scout', 'delivery_manager', 'dispatch', 'cosigner']) {
      const ids = buildNavGroups({ user: { role }, hasPermission: () => true }).flatMap((g) => g.items.map((i) => i.id))
      expect(ids.filter((id) => id.startsWith('acct-')), role).toEqual([])
    }
    const without = buildNavGroups(accountant(['approvals.view'])).flatMap((g) => g.items.map((i) => i.id))
    expect(without.filter((id) => id.startsWith('acct-') || ['refunds', 'commissions', 'reconciliation'].includes(id))).toEqual([])
  })

  it('opens Commissions on commission.view_all, as the server does', () => {
    const ids = buildNavGroups(accountant(['commission.view_all'])).flatMap((g) => g.items.map((i) => i.id))
    expect(ids).toContain('commissions')
    expect(ids).not.toContain('refunds')
  })

  it('counts Escrow in its badge and Super Admin steps into a rebuilt Accounting workspace', () => {
    expect(BADGE_KEY_BY_TAB.escrow).toBe('escrow')
    expect(STEP_IN_TEAMS.find((t) => t.id === 'accounting').rebuilt).toBe(true)
    expect(isRebuiltRole('accountant')).toBe(true)
  })
})
