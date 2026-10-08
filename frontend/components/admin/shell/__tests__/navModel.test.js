import { describe, expect, it } from 'vitest'
import { NAV_ITEMS, buildNavGroups, isPermittedTab, makeBadgeFor, pickBottomBarItems } from '../navModel.js'

const groups = [
  { id: 'a', label: 'A', items: [
    { id: 'kyc', icon: '🪪', label: 'KYC Queue' },
    { id: 'moderation', icon: '📋', label: 'Listings Moderation' },
  ] },
  { id: 'b', label: 'B', items: [
    { id: 'users', icon: '👥', label: 'Users' },
    { id: 'messaging', icon: '💬', label: 'Messaging / Tickets' },
    { id: 'analytics', icon: '📊', label: 'Analytics' },
  ] },
]
const ids = (items) => items.map((i) => i.id)

describe('pickBottomBarItems', () => {
  it('puts panels with pending work first, in nav order rather than count order', () => {
    const counts = { messaging: 2, moderation: 40 }
    expect(ids(pickBottomBarItems(groups, (id) => counts[id] || 0))).toEqual(['moderation', 'messaging', 'kyc'])
  })

  it('keeps the same order when counts change but stay non-zero', () => {
    const counts = { messaging: 50, moderation: 1 }
    expect(ids(pickBottomBarItems(groups, (id) => counts[id] || 0))).toEqual(['moderation', 'messaging', 'kyc'])
  })

  it('fills with the first permitted panels when nothing is pending', () => {
    expect(ids(pickBottomBarItems(groups, () => 0))).toEqual(['kyc', 'moderation', 'users'])
  })

  it('returns fewer than three when fewer are permitted, never padding', () => {
    expect(ids(pickBottomBarItems([groups[0]], () => 0))).toEqual(['kyc', 'moderation'])
  })
})

describe('isPermittedTab', () => {
  it('always permits overview', () => expect(isPermittedTab([], 'overview')).toBe(true))
  it('permits a tab present in the groups', () => expect(isPermittedTab(groups, 'users')).toBe(true))
  it('rejects an absent or unknown tab', () => {
    expect(isPermittedTab(groups, 'staff')).toBe(false)
    expect(isPermittedTab(groups, 'not-a-panel')).toBe(false)
  })
})

describe('makeBadgeFor', () => {
  it('maps a tab id to its staff-badges key and defaults to 0', () => {
    const badgeFor = makeBadgeFor({ kyc: 3, listings: 0 })
    expect(badgeFor('kyc')).toBe(3)
    expect(badgeFor('moderation')).toBe(0)
    expect(badgeFor('users')).toBe(0)
    expect(makeBadgeFor(undefined)('kyc')).toBe(0)
  })
})

describe('buildNavGroups', () => {
  it('drops groups with no permitted items', () => {
    const auth = { hasPermission: (c) => c === 'messaging.manage' }
    const result = buildNavGroups(auth)
    expect(result.map((g) => g.id)).toEqual(['system', 'my-work'])
    expect(ids(result[0].items)).toEqual(['messaging'])
  })
})

describe('My Work group', () => {
  const authWith = (perms) => ({ hasPermission: (c) => perms.includes(c) })
  const myWork = (perms) => buildNavGroups(authWith(perms)).find((g) => g.id === 'my-work')

  it('gives every staffer Approvals, Tasks and Activity', () => {
    expect(myWork([]).items.map((i) => i.id)).toEqual(['approvals', 'tasks', 'activity'])
  })

  it('adds Call Log and My Team for the permissions that unlock them', () => {
    expect(myWork(['calls.log', 'staff.invite_team']).items.map((i) => i.id)).toEqual(['approvals', 'tasks', 'calls', 'activity', 'my-team'])
  })

  it('maps the approvals badge to approvals_waiting', () => {
    expect(makeBadgeFor({ approvals_waiting: 4 })('approvals')).toBe(4)
  })

  it('maps the tasks badge to tasks_overdue', () => {
    expect(makeBadgeFor({ tasks_overdue: 2 })('tasks')).toBe(2)
  })
})

describe('per-role menus', () => {
  const authAs = (role, perms) => ({ user: { role }, hasPermission: (c) => perms.includes(c) })
  const groupOf = (groups, itemId) => groups.find((g) => g.items.some((i) => i.id === itemId))?.label

  it("places an Operations lead's tools in the groups from the design canvas", () => {
    const groups = buildNavGroups(authAs('operations', ['kyc.approve', 'listings.moderate', 'calls.log', 'staff.invite_team', 'site_settings.manage', 'messaging.manage']))
    expect(groupOf(groups, 'kyc')).toBe('Moderation')
    expect(groupOf(groups, 'my-team')).toBe('People')
    expect(groupOf(groups, 'messaging')).toBe('Service')
    expect(groupOf(groups, 'activity')).toBe('Staff activity')
    expect(groupOf(groups, 'calls')).toBe('My work')
    expect(groupOf(groups, 'site-settings')).toBe('Settings')
  })

  it('gives support an Inbox, Calls and Queues', () => {
    const groups = buildNavGroups(authAs('support', ['messaging.manage', 'calls.log', 'reviews.moderate', 'users.view']))
    expect(groupOf(groups, 'messaging')).toBe('Inbox')
    expect(groupOf(groups, 'calls')).toBe('Calls')
    expect(groupOf(groups, 'reviews')).toBe('Queues')
    expect(groupOf(groups, 'users')).toBe('People')
  })

  it("puts a granted tool the role's menu doesn't place under More tools", () => {
    const groups = buildNavGroups(authAs('support', ['messaging.manage', 'analytics.view']))
    expect(groupOf(groups, 'analytics')).toBe('More tools')
    expect(groups.at(-1).id).toBe('more')
  })

  it('shows every permitted item exactly once and no empty group, for every role', () => {
    for (const role of ['super_admin', 'operations', 'accountant', 'marketing', 'support', 'scout', 'delivery_manager', 'dispatch']) {
      const groups = buildNavGroups({ user: { role }, hasPermission: () => true })
      const ids = groups.flatMap((g) => g.items.map((i) => i.id))
      expect(new Set(ids).size).toBe(ids.length)
      expect([...ids].sort()).toEqual(NAV_ITEMS.map((i) => i.id).sort())
      expect(groups.every((g) => g.items.length > 0)).toBe(true)
    }
  })

  it('keeps the original grouping for a session without a known role', () => {
    const groups = buildNavGroups({ user: { role: 'not-a-role' }, hasPermission: () => true })
    expect(groups.map((g) => g.id)).toEqual(['moderation', 'finance', 'users-roles', 'field-ops', 'content', 'system', 'my-work'])
  })
})
