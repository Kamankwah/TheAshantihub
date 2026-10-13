import { describe, expect, it } from 'vitest'
import { buildNavGroups } from '../navModel.js'

// The external co-signer sees the approvals inbox and their own sign-in, nothing else.
describe('co-signer menu', () => {
  it('has Decisions and Account only, even if the session reports more permissions', () => {
    const groups = buildNavGroups({ user: { role: 'cosigner' }, hasPermission: (code) => code === 'approvals.cosign' })
    expect(groups.map((g) => [g.label, g.items.map((i) => i.id)])).toEqual([
      ['Decisions', ['approvals']],
      ['Account', ['security']],
    ])
  })

  it('does not offer the Super Admin rules screen', () => {
    const ids = buildNavGroups({ user: { role: 'cosigner' }, hasPermission: () => true }).flatMap((g) => g.items.map((i) => i.id))
    expect(ids).not.toContain('approval-rules')
  })
})
