import { describe, expect, it } from 'vitest'
import { BADGE_KEY_BY_TAB, NAV_ITEMS, buildNavGroups, makeBadgeFor, overviewLabel } from '../navModel.js'

const manager = (perms = 'all') => ({ user: { role: 'delivery_manager' }, hasPermission: (c) => perms === 'all' || perms.includes(c) })

describe('the Delivery Manager menu (canvas 2026-10-07, 20 screens)', () => {
  const groups = buildNavGroups(manager())
  it('has the canvas groups and items in order, and nothing else', () => {
    expect(groups.map((g) => [g.label, g.items.map((i) => i.label)])).toEqual([
      ['Live', ['Dispatch queue', 'Scheduled', 'Active deliveries']],
      ['Issues', ['Disputes & returns']],
      ['Fleet', ['Riders & drivers', 'Documents', 'Vehicles', 'Invite a rider']],
      ['Planning', ['Shifts', 'Zones']],
      ['Cash', ['Cash on delivery', 'Rider payouts']],
      ['Settings', ['Delivery pricing', 'Auto-assign rules', 'Delivery time limits']],
      ['My work', ['Tasks', 'Approvals', 'Call Log', 'Activity', 'Sign-in & Security']],
      ['Reports', ['My reports', "Riders' reports"]],
    ])
  })
  it('opens on Live operations', () => expect(overviewLabel('delivery_manager')).toBe('Live operations'))
  it('shows each group only for the permission that opens it', () => {
    const labels = (perms) => buildNavGroups(manager(perms)).flatMap((g) => g.items.map((i) => i.label))
    expect(labels(['delivery.manage'])).toEqual(expect.arrayContaining(['Dispatch queue', 'Active deliveries', 'Disputes & returns']))
    expect(labels(['delivery.manage'])).not.toContain('Documents')
    expect(labels(['delivery.fleet'])).toEqual(expect.arrayContaining(['Riders & drivers', 'Shifts']))
    expect(labels(['delivery.cash'])).toEqual(expect.arrayContaining(['Cash on delivery', 'Rider payouts']))
    expect(labels(['delivery.rates'])).toEqual(expect.arrayContaining(['Delivery pricing', 'Auto-assign rules', 'Delivery time limits']))
  })
  it('never shows a Delivery Manager screen to another role', () => {
    for (const role of ['super_admin', 'operations', 'accountant', 'dispatch', 'scout', 'support', 'marketing']) {
      const ids = buildNavGroups({ user: { role }, hasPermission: () => true }).flatMap((g) => g.items.map((i) => i.id))
      expect(ids.filter((id) => id.startsWith('dm-')), role).toEqual([])
    }
  })
  it('keeps My Team for a manager without the fleet permission', () => {
    const labels = (perms) => buildNavGroups(manager(perms)).flatMap((g) => g.items.map((i) => i.label))
    expect(labels(['staff.invite_team'])).toContain('My Team')
    expect(labels(['staff.invite_team', 'delivery.fleet'])).not.toContain('My Team')
    expect(labels(['staff.invite_team', 'delivery.fleet'])).toContain('Invite a rider')
  })
  it('puts a badge only on queues that are counted from records', () => {
    expect(BADGE_KEY_BY_TAB).toMatchObject({ 'dm-queue': 'delivery_queue', 'dm-cases': 'delivery_cases', 'dm-documents': 'delivery_documents', 'dm-cash': 'delivery_cash' })
    const badge = makeBadgeFor({ delivery_queue: 4, delivery_cases: 5 }, 'delivery_manager')
    expect([badge('dm-queue'), badge('dm-cases'), badge('dm-shifts')]).toEqual([4, 5, 0])
    expect(NAV_ITEMS.filter((i) => i.id.startsWith('dm-'))).toHaveLength(15)
  })
})

describe('the Scheduled orders tab outside the Delivery Manager menu', () => {
  const ids = (role, perms) => buildNavGroups({ user: { role }, hasPermission: (c) => perms.includes(c) }).flatMap((g) => g.items.map((i) => i.id))
  it('scheduled tab appears for orders.manage_delivery', () => {
    expect(ids('scout', ['orders.manage_delivery'])).toContain('delivery-scheduled')
    expect(ids('scout', ['delivery.manage'])).toContain('delivery-scheduled')
  })
  it('is absent without either permission, and the Delivery Manager keeps its own Scheduled screen', () => {
    expect(ids('scout', ['kyc.approve'])).not.toContain('delivery-scheduled')
    expect(ids('delivery_manager', ['delivery.manage', 'orders.manage_delivery'])).not.toContain('delivery-scheduled')
  })
})
