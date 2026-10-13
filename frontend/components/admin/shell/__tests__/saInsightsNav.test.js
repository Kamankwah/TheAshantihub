import { describe, expect, it } from 'vitest'
import { PLACEHOLDER_TABS, buildNavGroups } from '../navModel.js'

const auth = (role) => ({ user: { role }, hasPermission: () => true })
const BUILT = ['commissions', 'refunds', 'growth-funnel', 'scheduled-exports']

describe('Super Admin Insights and Money screens (SA-7)', () => {
  it('are built, not placeholders, and sit in the canvas groups', () => {
    for (const id of BUILT) expect(PLACEHOLDER_TABS.super_admin.has(id)).toBe(false)
    const groups = buildNavGroups(auth('super_admin'))
    const items = (group) => groups.find((g) => g.id === group).items.map((i) => i.label)
    expect(items('money')).toEqual(expect.arrayContaining(['Revenue & sales', 'Commissions', 'Refunds']))
    expect(items('insights')).toEqual(['Analytics', 'Growth funnel', 'Reports hub', 'Scheduled exports'])
  })

  it('stay out of every other role\'s menu', () => {
    // The Accountant has Commissions and Refunds too (the Accounting canvas); only Growth funnel and
    // Scheduled exports stay Super Admin's.
    for (const role of ['operations', 'accountant', 'marketing', 'support', 'scout', 'delivery_manager', 'dispatch']) {
      const all = buildNavGroups(auth(role)).flatMap((g) => g.items.map((i) => i.id))
      for (const id of BUILT) {
        if (role === 'accountant' && ['commissions', 'refunds'].includes(id)) continue
        expect(all).not.toContain(id)
      }
    }
  })
})
