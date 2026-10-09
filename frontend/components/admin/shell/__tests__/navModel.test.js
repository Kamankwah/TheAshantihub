import { describe, expect, it } from 'vitest'
import { NAV_ITEMS, buildNavGroups, isPermittedTab, makeBadgeFor, overviewLabel, pickBottomBarItems } from '../navModel.js'

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

  it('gives every staffer Approvals, Tasks, My Reports, Activity and Sign-in & Security', () => {
    expect(myWork([]).items.map((i) => i.id)).toEqual(['approvals', 'tasks', 'reports', 'activity', 'security'])
  })

  it('adds Call Log, Team Reports and My Team for the permissions that unlock them', () => {
    expect(myWork(['calls.log', 'staff.invite_team']).items.map((i) => i.id)).toEqual(['approvals', 'tasks', 'calls', 'reports', 'team-reports', 'activity', 'my-team', 'security'])
  })

  it('shows Sessions & Devices to staff.manage only', () => {
    const ids = (perms) => buildNavGroups({ hasPermission: (c) => perms.includes(c) }).flatMap((g) => g.items.map((i) => i.id))
    expect(ids([])).not.toContain('sessions')
    expect(ids(['staff.manage'])).toContain('sessions')
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

describe('Register a business (staff phase 2A)', () => {
  const authAs = (role, perms) => ({ user: { role }, hasPermission: (c) => perms.includes(c) })
  const groupOf = (groups, itemId) => groups.find((g) => g.items.some((i) => i.id === itemId))?.label
  const allIds = (groups) => groups.flatMap((g) => g.items.map((i) => i.id))

  it('is shown only with businesses.register', () => {
    expect(allIds(buildNavGroups(authAs('scout', ['calls.log'])))).not.toContain('register-business')
    expect(allIds(buildNavGroups(authAs('scout', ['businesses.register'])))).toContain('register-business')
    expect(NAV_ITEMS.find((i) => i.id === 'register-business')).toMatchObject({ icon: '➕', label: 'Register a business' })
  })

  it("shows a scout's tasks as Follow-ups under My businesses; other roles keep Tasks", () => {
    const scout = buildNavGroups(authAs('scout', ['businesses.manage_portfolio', 'calls.log']))
    expect(scout.flatMap((g) => g.items).find((i) => i.id === 'tasks').label).toBe('Follow-ups')
    expect(groupOf(scout, 'tasks')).toBe('My businesses')
    const ops = buildNavGroups(authAs('operations', ['portfolio.manage']))
    expect(ops.flatMap((g) => g.items).find((i) => i.id === 'tasks').label).toBe('Tasks')
  })

  it('gives a scout Pipeline, Activity, Reports and Account', () => {
    const groups = buildNavGroups(authAs('scout', ['businesses.register', 'scouts.verify', 'calls.log']))
    expect(groups.map((g) => g.label)).toEqual(['Pipeline', 'My businesses', 'Activity', 'Reports', 'Account'])
    expect(groupOf(groups, 'register-business')).toBe('Pipeline')
    expect(groupOf(groups, 'field-verification')).toBe('Activity')
  })

  it("puts it in Operations' Businesses group, right after People", () => {
    const groups = buildNavGroups(authAs('operations', ['businesses.register', 'staff.invite_team']))
    const ids = groups.map((g) => g.id)
    expect(ids.indexOf('businesses')).toBe(ids.indexOf('people') + 1)
    expect(groupOf(groups, 'register-business')).toBe('Businesses')
  })

  it('gives Super Admin a Businesses group too', () => {
    expect(groupOf(buildNavGroups(authAs('super_admin', ['businesses.register'])), 'register-business')).toBe('Businesses')
  })

  it('sits with the field tools for a session without a known role', () => {
    expect(groupOf(buildNavGroups({ hasPermission: () => true }), 'register-business')).toBe('Field Operations')
  })

  it('never names a group after an item, for any role', () => {
    for (const role of ['super_admin', 'operations', 'accountant', 'marketing', 'support', 'scout', 'delivery_manager', 'dispatch', 'not-a-role']) {
      const built = buildNavGroups({ user: { role }, hasPermission: () => true })
      // The labels this role actually reads (a scout's relabels included, plus the pinned Overview / Today).
      const itemLabels = new Set([overviewLabel(role), ...built.flatMap((g) => g.items.map((i) => i.label))])
      for (const group of built) {
        expect(itemLabels.has(group.label)).toBe(false)
      }
    }
  })
})

describe('portfolio menus (staff phase 2A)', () => {
  const authAs = (role, perms) => ({ user: { role }, hasPermission: (c) => perms.includes(c) })
  const groupOf = (groups, itemId) => groups.find((g) => g.items.some((i) => i.id === itemId))?.label
  const idsIn = (groups, label) => groups.find((g) => g.label === label)?.items.map((i) => i.id)
  const allIds = (perms) => buildNavGroups({ hasPermission: (c) => perms.includes(c) }).flatMap((g) => g.items.map((i) => i.id))

  it("puts a scout's Portfolio under My businesses, next to Field Verification", () => {
    const groups = buildNavGroups(authAs('scout', ['businesses.manage_portfolio', 'businesses.register', 'scouts.verify', 'calls.log']))
    expect(groups.map((g) => g.label)).toEqual(['Pipeline', 'My businesses', 'Activity', 'Performance', 'Reports', 'Account'])
    expect(idsIn(groups, 'My businesses')).toEqual(['portfolio', 'tasks', 'approvals'])
    expect(idsIn(groups, 'Activity')).toEqual(['calls', 'visits', 'field-verification'])
  })

  it('gives a scout Targets under Performance, and Operations none', () => {
    const scout = buildNavGroups(authAs('scout', ['businesses.manage_portfolio', 'businesses.register']))
    expect(idsIn(scout, 'Performance')).toEqual(['targets', 'leaderboard'])
    expect(NAV_ITEMS.find((i) => i.id === 'targets')).toMatchObject({ icon: '🎯', label: 'Targets' })
    expect(allIds(['portfolio.manage', 'businesses.register'])).not.toContain('targets')
  })

  it('gives a scout Commission and Leaderboard under Performance, and Accounting and Super Admin the policy panel', () => {
    const scout = buildNavGroups(authAs('scout', ['businesses.manage_portfolio', 'businesses.register', 'commission.view_own']))
    expect(idsIn(scout, 'Performance')).toEqual(['targets', 'commission', 'leaderboard'])
    expect(NAV_ITEMS.find((i) => i.id === 'commission')).toMatchObject({ label: 'Commission' })
    const accountant = buildNavGroups(authAs('accountant', ['commission.view_all', 'commission.policy', 'subscription_plans.manage']))
    expect(groupOf(accountant, 'commission-policy')).toBe('Plans & pricing')
    expect(groupOf(buildNavGroups({ user: { role: 'super_admin' }, hasPermission: () => true }), 'commission-policy')).toBe('Settings')
    expect(allIds(['portfolio.manage', 'businesses.register'])).not.toContain('commission')
    expect(allIds(['portfolio.manage', 'businesses.register'])).not.toContain('commission-policy')
  })

  it('gives Operations a Businesses group right after People', () => {
    const groups = buildNavGroups(authAs('operations', ['portfolio.manage', 'businesses.register', 'staff.invite_team']))
    const labels = groups.map((g) => g.label)
    expect(labels.indexOf('Businesses')).toBe(labels.indexOf('People') + 1)
    expect(idsIn(groups, 'Businesses')).toEqual(['all-portfolios', 'at-risk', 'subscriptions-due', 'register-business'])
  })

  it('gives Super Admin a Businesses group and keeps Portfolio under Teams (step in)', () => {
    const groups = buildNavGroups({ user: { role: 'super_admin' }, hasPermission: () => true })
    expect(groupOf(groups, 'all-portfolios')).toBe('Businesses')
    expect(groupOf(groups, 'at-risk')).toBe('Businesses')
    expect(groupOf(groups, 'register-business')).toBe('Businesses')
    expect(groupOf(groups, 'portfolio')).toBe('Teams (step in)')
  })

  it('shows Portfolio to account managers and the Operations screens only with portfolio.manage', () => {
    expect(allIds(['businesses.manage_portfolio'])).toContain('portfolio')
    expect(allIds(['businesses.manage_portfolio'])).not.toContain('all-portfolios')
    expect(allIds(['portfolio.manage'])).toEqual(expect.arrayContaining(['all-portfolios', 'at-risk']))
    expect(allIds(['portfolio.manage'])).not.toContain('portfolio')
  })

  it('labels the three items as on the canvas', () => {
    const byId = Object.fromEntries(NAV_ITEMS.map((i) => [i.id, i]))
    expect([byId.portfolio.label, byId.portfolio.icon]).toEqual(['Portfolio', '🏪'])
    expect([byId['all-portfolios'].label, byId['all-portfolios'].icon]).toEqual(['All portfolios', '🗂️'])
    expect([byId['at-risk'].label, byId['at-risk'].icon]).toEqual(['At risk', '⚠️'])
  })
})

describe('Subscriptions due and Fraud cases (staff phase 2A)', () => {
  const authAs = (role, perms) => ({ user: { role }, hasPermission: (c) => perms.includes(c) })
  const everything = (role) => ({ user: { role }, hasPermission: () => true })
  const groupOf = (groups, itemId) => groups.find((g) => g.items.some((i) => i.id === itemId))?.label
  const idsIn = (groups, label) => groups.find((g) => g.label === label)?.items.map((i) => i.id)
  const allIds = (perms) => buildNavGroups({ hasPermission: (c) => perms.includes(c) }).flatMap((g) => g.items.map((i) => i.id))

  it('labels the two items as on the canvas', () => {
    const byId = Object.fromEntries(NAV_ITEMS.map((i) => [i.id, i]))
    expect([byId['subscriptions-due'].label, byId['subscriptions-due'].icon]).toEqual(['Subscriptions due', '⏳'])
    expect([byId['fraud-cases'].label, byId['fraud-cases'].icon]).toEqual(['Fraud cases', '🚩'])
  })

  it('shows Subscriptions due with portfolio.manage, and Fraud cases with fraud.manage or fraud.flag', () => {
    expect(allIds(['portfolio.manage'])).toContain('subscriptions-due')
    expect(allIds(['fraud.flag'])).not.toContain('subscriptions-due')
    expect(allIds(['fraud.manage'])).toContain('fraud-cases')
    expect(allIds(['fraud.flag'])).toContain('fraud-cases')
    expect(allIds(['portfolio.manage'])).not.toContain('fraud-cases')
  })

  it("puts Subscriptions due in Operations' Businesses group before Register, and Fraud cases at the end of Service", () => {
    const groups = buildNavGroups(authAs('operations', [
      'portfolio.manage', 'businesses.register', 'fraud.manage', 'fraud.flag', 'messaging.manage', 'disputes.flag', 'orders.manage_delivery',
    ]))
    expect(idsIn(groups, 'Businesses')).toEqual(['all-portfolios', 'at-risk', 'subscriptions-due', 'register-business'])
    expect(idsIn(groups, 'Service')).toEqual(['messaging', 'disputes', 'delivery', 'fraud-cases'])
  })

  it("puts Fraud cases at the end of Support's Queues", () => {
    const groups = buildNavGroups(authAs('support', ['fraud.flag', 'contact_messages.manage', 'reviews.moderate', 'disputes.flag', 'orders.manage_delivery']))
    expect(idsIn(groups, 'Queues')).toEqual(['contact-messages', 'reviews', 'disputes', 'delivery', 'fraud-cases'])
  })

  it('gives Super Admin both: Subscriptions due under Businesses, Fraud cases at the end of Marketplace', () => {
    const groups = buildNavGroups(everything('super_admin'))
    expect(idsIn(groups, 'Businesses')).toEqual(['all-portfolios', 'at-risk', 'subscriptions-due', 'register-business'])
    expect(idsIn(groups, 'Marketplace').at(-1)).toBe('fraud-cases')
  })

  it('keeps both inside the original groups for a session without a known role', () => {
    const groups = buildNavGroups(everything('not-a-role'))
    expect(groupOf(groups, 'subscriptions-due')).toBe('Field Operations')
    expect(groupOf(groups, 'fraud-cases')).toBe('Moderation')
  })

  it('adds no badge for either', () => {
    const badgeFor = makeBadgeFor({ kyc: 3, approvals_waiting: 2 })
    expect(badgeFor('subscriptions-due')).toBe(0)
    expect(badgeFor('fraud-cases')).toBe(0)
  })
})

describe('Visits (staff WP1)', () => {
  const authAs = (role, perms) => ({ user: { role }, hasPermission: (c) => perms.includes(c) })
  const idsOf = (auth) => buildNavGroups(auth).flatMap((g) => g.items.map((i) => i.id))

  it('is shown to a scout who manages a portfolio or verifies, and to no one else', () => {
    expect(idsOf(authAs('scout', ['businesses.manage_portfolio']))).toContain('visits')
    expect(idsOf(authAs('scout', ['scouts.verify']))).toContain('visits')
    expect(idsOf(authAs('scout', ['calls.log']))).not.toContain('visits')
    expect(idsOf(authAs('support', ['calls.log']))).not.toContain('visits')
  })

  it("sits beside Calls in a scout's menu", () => {
    const groups = buildNavGroups(authAs('scout', ['businesses.manage_portfolio', 'scouts.verify', 'calls.log']))
    expect(groups.find((g) => g.items.some((i) => i.id === 'visits')).items.map((i) => i.id)).toEqual(['calls', 'visits', 'field-verification'])
    expect(NAV_ITEMS.find((i) => i.id === 'visits')).toMatchObject({ icon: '🧭', label: 'Visits' })
  })
})


describe('Prospects menu item', () => {
  const authAs = (role, perms) => ({ user: { role }, hasPermission: (c) => perms.includes(c) })
  const idsOf = (auth) => buildNavGroups(auth).flatMap((g) => g.items.map((i) => i.id))
  it('is scout-only: it needs both registering and managing a portfolio', () => {
    expect(idsOf(authAs('scout', ['businesses.register', 'businesses.manage_portfolio']))).toContain('prospects')
    expect(idsOf(authAs('scout', ['businesses.register']))).not.toContain('prospects')
    expect(idsOf(authAs('operations', ['businesses.manage_portfolio']))).not.toContain('prospects')
    expect(idsOf(authAs('scout', ['calls.log']))).not.toContain('prospects')
  })
  it('opens a scout\'s Pipeline, before Register a business', () => {
    const pipeline = buildNavGroups(authAs('scout', ['businesses.register', 'businesses.manage_portfolio', 'calls.log'])).find((g) => g.id === 'pipeline')
    expect(pipeline.items.map((i) => i.id)).toEqual(['prospects', 'register-business'])
  })
})

describe("the scout's menu in the canvas's words (staff WP6)", () => {
  const PERMS = ['businesses.register', 'businesses.manage_portfolio', 'scouts.verify', 'calls.log', 'commission.view_own']
  const scout = () => buildNavGroups({ user: { role: 'scout' }, hasPermission: (c) => PERMS.includes(c) })
  const labelsIn = (groups, label) => groups.find((g) => g.label === label)?.items.map((i) => i.label)

  it('lays out the canvas groups with scout-only labels', () => {
    const groups = scout()
    expect(groups.map((g) => g.label)).toEqual(['Pipeline', 'My businesses', 'Activity', 'Performance', 'Reports', 'Account'])
    expect(labelsIn(groups, 'Pipeline')).toEqual(['Prospects', 'Register a business'])
    expect(labelsIn(groups, 'My businesses')).toEqual(['Portfolio', 'Follow-ups', 'Sent for approval'])
    expect(labelsIn(groups, 'Activity')).toEqual(['Calls', 'Visits', 'Field Verification'])
    expect(labelsIn(groups, 'Performance')).toEqual(['Targets', 'Commission', 'Leaderboard'])
    expect(labelsIn(groups, 'Reports')).toEqual(['Day, week & month'])
    expect(labelsIn(groups, 'Account')).toEqual(['Profile & sign out', 'My activity'])
  })

  it('calls the scout\'s Overview "Today" and everyone else\'s "Overview"', () => {
    expect(overviewLabel('scout')).toBe('Today')
    for (const role of ['super_admin', 'operations', 'accountant', 'marketing', 'support', 'delivery_manager', 'dispatch']) expect(overviewLabel(role)).toBe('Overview')
  })

  it('leaves the shared labels, and every other role\'s, as they were', () => {
    const base = Object.fromEntries(NAV_ITEMS.map((i) => [i.id, i.label]))
    expect(base).toMatchObject({ approvals: 'Approvals', calls: 'Call Log', reports: 'My Reports', security: 'Sign-in & Security', activity: 'Activity', tasks: 'Tasks' })
    const ops = buildNavGroups({ user: { role: 'operations' }, hasPermission: () => true }).flatMap((g) => g.items)
    expect(ops.find((i) => i.id === 'reports').label).toBe('My Reports')
    expect(ops.find((i) => i.id === 'security').label).toBe('Sign-in & Security')
  })
})
