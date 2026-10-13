import { describe, expect, it } from 'vitest'
import { NAV_ITEMS, PLACEHOLDER_TABS, buildNavGroups, isPermittedTab, makeBadgeFor, overviewLabel, pickBottomBarItems } from '../navModel.js'

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

  it('maps the tasks badge to tasks_due (overdue plus due today)', () => {
    expect(makeBadgeFor({ tasks_due: 2, tasks_overdue: 1 })('tasks')).toBe(2)
  })
})

// Super Admin screens that are built (no longer placeholders) but still no other role's.
const SA_BUILT = ['step-in-operations', 'step-in-support', 'step-in-delivery', 'step-in-marketing', 'step-in-accounting', 'teams-reporting', 'roles-permissions', 'commissions', 'refunds', 'growth-funnel', 'scheduled-exports', 'approval-rules', 'payouts-payroll', 'reconciliation', 'delivery-pricing', 'tax-tables', 'integrations', 'system-health', 'sign-in-history', 'staff-announcements', 'data-exports-log', 'notification-center']
const SA_ONLY = NAV_ITEMS.filter((i) => i.placeholder === 'super_admin').map((i) => i.id).concat('invites', SA_BUILT)
// 'leave' is also Super Admin's (the canvas's Leave & holidays), but no other role's.
// The Marketing canvas screens are Marketing's alone.
const MK_ONLY = NAV_ITEMS.filter((i) => i.id.startsWith('mk-')).map((i) => i.id)
const OPS_ONLY = [...MK_ONLY, 'ops-scouts', 'support-team', 'leave', 'hero-events', 'support-issues', 'deliveries-returns', 'visit-map', 'zones', ...SA_ONLY]

describe('per-role menus', () => {
  const authAs = (role, perms) => ({ user: { role }, hasPermission: (c) => perms.includes(c) })
  const groupOf = (groups, itemId) => groups.find((g) => g.items.some((i) => i.id === itemId))?.label

  it("places an Operations lead's tools in the groups from the design canvas", () => {
    const groups = buildNavGroups(authAs('operations', ['kyc.approve', 'listings.moderate', 'calls.log', 'staff.invite_team', 'site_settings.manage', 'messaging.manage']))
    expect(groupOf(groups, 'kyc')).toBe('Moderation')
    expect(groupOf(groups, 'my-team')).toBe('People')
    expect(groupOf(groups, 'activity')).toBe('Activity')
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

  it('shows every permitted item exactly once and no empty group, for every role but Operations and Super Admin (exhaustive menus; the Marketing menu is the canvas alone, below)', () => {
    for (const role of ['accountant', 'support', 'scout', 'delivery_manager', 'dispatch']) {
      const groups = buildNavGroups({ user: { role }, hasPermission: () => true })
      const ids = groups.flatMap((g) => g.items.map((i) => i.id))
      expect(new Set(ids).size).toBe(ids.length)
      // The Operations canvas screens appear for no other role.
      expect([...ids].sort()).toEqual(NAV_ITEMS.filter((i) => !OPS_ONLY.includes(i.id)).map((i) => i.id).sort())
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

  it("is not in Operations' menu (the 2026-10-12 canvas leaves it out; the permission stays)", () => {
    const groups = buildNavGroups(authAs('operations', ['businesses.register', 'staff.invite_team']))
    expect(allIds(groups)).not.toContain('register-business')
  })

  it("is not in Super Admin's menu either (the 2026-10-07 canvas has no such item; the permission stays)", () => {
    expect(allIds(buildNavGroups(authAs('super_admin', ['businesses.register'])))).not.toContain('register-business')
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
    expect(idsIn(groups, 'Businesses')).toEqual(['all-portfolios', 'at-risk', 'subscriptions-due'])
  })

  it("shows All portfolios to Super Admin as the canvas's Businesses, under Marketplace, and no Portfolio or At risk", () => {
    const groups = buildNavGroups({ user: { role: 'super_admin' }, hasPermission: () => true })
    expect(groupOf(groups, 'all-portfolios')).toBe('Marketplace')
    expect(groups.flatMap((g) => g.items).find((i) => i.id === 'all-portfolios').label).toBe('Businesses')
    expect(groups.flatMap((g) => g.items.map((i) => i.id))).not.toContain('at-risk')
    expect(groups.flatMap((g) => g.items.map((i) => i.id))).not.toContain('portfolio')
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

  it("puts Subscriptions due in Operations' Businesses group, and Fraud cases in Service", () => {
    const groups = buildNavGroups(authAs('operations', [
      'portfolio.manage', 'businesses.register', 'fraud.manage', 'fraud.flag', 'messaging.manage', 'disputes.flag', 'orders.manage_delivery',
    ]))
    expect(idsIn(groups, 'Businesses')).toEqual(['all-portfolios', 'at-risk', 'subscriptions-due'])
    // Messaging, Disputes and Delivery Management are not in the Operations menu; the two service screens need service_issues.view.
    expect(idsIn(groups, 'Service')).toEqual(['fraud-cases'])
  })

  it("puts Fraud cases at the end of Support's Queues", () => {
    const groups = buildNavGroups(authAs('support', ['fraud.flag', 'contact_messages.manage', 'reviews.moderate', 'disputes.flag', 'orders.manage_delivery']))
    expect(idsIn(groups, 'Queues')).toEqual(['contact-messages', 'reviews', 'disputes', 'delivery', 'fraud-cases'])
  })

  it("gives Super Admin Fraud cases as the canvas's Fraud & anomaly alerts under Security & audit, and no Subscriptions due", () => {
    const groups = buildNavGroups(everything('super_admin'))
    expect(groupOf(groups, 'fraud-cases')).toBe('Security & audit')
    expect(groups.flatMap((g) => g.items).find((i) => i.id === 'fraud-cases').label).toBe('Fraud & anomaly alerts')
    expect(groups.flatMap((g) => g.items.map((i) => i.id))).not.toContain('subscriptions-due')
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

  it('x', () => {
    expect(overviewLabel('scout')).toBe('Today')
    for (const role of ['operations', 'accountant', 'marketing', 'support', 'delivery_manager', 'dispatch']) expect(overviewLabel(role)).toBe('Overview')
    expect(overviewLabel('super_admin')).toBe('Command center')
  })

  it('leaves the shared labels, and every other role\'s, as they were', () => {
    const base = Object.fromEntries(NAV_ITEMS.map((i) => [i.id, i.label]))
    expect(base).toMatchObject({ approvals: 'Approvals', calls: 'Call Log', reports: 'My Reports', security: 'Sign-in & Security', activity: 'Activity', tasks: 'Tasks' })
    const ops = buildNavGroups({ user: { role: 'operations' }, hasPermission: () => true }).flatMap((g) => g.items)
    expect(ops.find((i) => i.id === 'reports').label).toBe('My reports')
    expect(ops.find((i) => i.id === 'security').label).toBe('Sign-in & Security')
  })
})

describe('Operations menu (canvas 2026-10-12)', () => {
  const OPS = [
    'kyc.approve', 'scouts.assign', 'listings.moderate', 'hero_media.approve', 'event.approve', 'reviews.moderate', 'users.view', 'users.manage',
    'orders.manage_delivery', 'site_settings.manage', 'zones.manage', 'contact_messages.manage', 'staff.invite_team', 'activity.view_team',
    'calls.log', 'businesses.register', 'portfolio.manage', 'targets.manage', 'leave.record', 'fraud.manage', 'fraud.flag', 'service_issues.view',
  ]
  const auth = { user: { role: 'operations' }, hasPermission: (c) => OPS.includes(c) }
  const groups = buildNavGroups(auth)

  it('has exactly the canvas groups and items, in order', () => {
    expect(groups.map((g) => [g.label, g.items.map((i) => i.label)])).toEqual([
      ['Approvals', ['Approvals inbox']],
      ['People', ['Scouts', 'Support team', 'Invite', 'Targets', 'Leave & calendar']],
      ['Businesses', ['All portfolios', 'At risk', 'Subscriptions due']],
      ['Moderation', ['KYC queue', 'Listings', 'Hero & events', 'Reviews']],
      ['Service', ['Support issues', 'Deliveries & returns', 'Fraud cases']],
      ['Activity', ['Staff activity', 'Visit map']],
      ['Reports', ['My reports', 'My team']],
      ['My work', ['Tasks', 'Call log', 'Sign-in & Security']],
      ['Settings', ['Zones', 'Site settings', 'Contact messages']],
    ])
  })

  it('drops Users, Scout Assignments, Register a business, Field Verification and Delivery Management, with no More tools', () => {
    const ids = groups.flatMap((g) => g.items.map((i) => i.id))
    for (const gone of ['users', 'scout-assignments', 'register-business', 'field-verification', 'delivery']) expect(ids).not.toContain(gone)
    expect(groups.some((g) => g.id === 'more')).toBe(false)
  })

  it('shows Targets to Operations through targets.manage', () => {
    expect(buildNavGroups({ user: { role: 'operations' }, hasPermission: (c) => c === 'targets.manage' }).flatMap((g) => g.items.map((i) => i.id))).toContain('targets')
  })

  it('shows the service screens only with service_issues.view', () => {
    const without = buildNavGroups({ user: { role: 'operations' }, hasPermission: (c) => OPS.includes(c) && c !== 'service_issues.view' }).flatMap((g) => g.items.map((i) => i.id))
    expect(without).not.toContain('support-issues')
    expect(without).not.toContain('deliveries-returns')
  })

  it('has no placeholder screens left: every Operations canvas screen is built', () => {
    expect([...PLACEHOLDER_TABS.operations]).toEqual([])
  })

  it('maps the canvas badges to staff-badges keys, summing Hero & events', () => {
    const badgeFor = makeBadgeFor({ at_risk: 4, subscriptions_due: 3, fraud_open: 4, team_reports_waiting: 5, support_issues: 0, deliveries_open: 0, hero: 1, events: 1 })
    expect(badgeFor('at-risk')).toBe(4)
    expect(badgeFor('subscriptions-due')).toBe(3)
    expect(badgeFor('fraud-cases')).toBe(4)
    expect(badgeFor('team-reports')).toBe(5)
    expect(badgeFor('support-issues')).toBe(0)
    expect(badgeFor('deliveries-returns')).toBe(0)
    expect(badgeFor('hero-events')).toBe(2)
  })
})

describe('Super Admin menu (canvases 2026-10-07)', () => {
  const auth = { user: { role: 'super_admin' }, hasPermission: () => true }
  const groups = buildNavGroups(auth)

  it('has exactly the canvas groups and items, in order, with the Security settings item', () => {
    expect(groups.map((g) => [g.label, g.items.map((i) => i.label)])).toEqual([
      ['Home', ['My approvals']],
      ['People', ['Staff directory', 'Teams & reporting lines', 'Invites', 'Roles & permissions', 'Sessions & devices', 'Leave & holidays']],
      ['Teams (step in)', ['Operations & scouts', 'Support', 'Delivery & dispatch', 'Marketing', 'Accounting']],
      ['Marketplace', ['Businesses', 'Customers', 'Listings & services', 'Orders & deliveries', 'Events & tickets', 'Disputes & returns']],
      ['Money', ['Revenue & sales', 'Payouts & payroll', 'Commissions', 'Refunds', 'Reconciliation']],
      ['Insights', ['Analytics', 'Growth funnel', 'Reports hub', 'Scheduled exports']],
      ['Security & audit', ['Audit log', 'Sign-in history', 'Fraud & anomaly alerts', 'Data exports log', 'Security settings']],
      ['Communication', ['Notification center', 'Staff announcements']],
      ['Settings', ['Approval rules & timers', 'Commission policy', 'Delivery pricing', 'Plans & prices', 'Target limits', 'Tax tables', 'Categories & zones', 'Integrations', 'System health']],
    ])
  })

  it('is exhaustive: no More tools, and dropped screens keep their permission', () => {
    expect(groups.some((g) => g.id === 'more')).toBe(false)
    const ids = groups.flatMap((g) => g.items.map((i) => i.id))
    for (const gone of ['kyc', 'hero', 'reviews', 'escrow', 'credit', 'messaging', 'tasks', 'calls', 'reports', 'at-risk', 'register-business', 'scout-assignments', 'site-settings']) expect(ids).not.toContain(gone)
    expect(NAV_ITEMS.find((i) => i.id === 'kyc').show(auth)).toBe(true) // the permission and panel are untouched
  })

  it('lists the unbuilt screens as placeholders for Super Admin only', () => {
    const placeholders = [...PLACEHOLDER_TABS.super_admin]
    // The step-in screens (SA-6) were the last placeholders: every canvas screen is built.
    expect(placeholders).toEqual([])
    for (const built of ['step-in-operations', 'step-in-accounting', 'teams-reporting', 'roles-permissions', 'approvals', 'staff', 'sessions', 'leave', 'transactions', 'analytics', 'activity', 'security', 'commission-policy', 'targets', 'categories-zones', 'invites', 'payouts-payroll', 'reconciliation', 'delivery-pricing', 'tax-tables', 'integrations', 'system-health']) {
      expect(placeholders).not.toContain(built)
    }
    for (const role of ['operations', 'accountant', 'scout']) {
      const others = buildNavGroups({ user: { role }, hasPermission: () => true }).flatMap((g) => g.items.map((i) => i.id))
      for (const id of placeholders) expect(others).not.toContain(id)
    }
  })

  it('shows the step-in screens only to a Super Admin holding staff.view_as', () => {
    const teams = (perms) => buildNavGroups({ user: { role: 'super_admin' }, hasPermission: (c) => perms.includes(c) }).find((g) => g.id === 'teams')
    expect(teams(['staff.view_as']).items.map((i) => i.id)).toEqual(['step-in-operations', 'step-in-support', 'step-in-delivery', 'step-in-marketing', 'step-in-accounting'])
    expect(teams([])).toBeUndefined()
    const ops = buildNavGroups({ user: { role: 'operations' }, hasPermission: () => true }).flatMap((g) => g.items.map((i) => i.id))
    expect(ops.filter((id) => id.startsWith('step-in-'))).toEqual([])
  })

  it("keeps the Super Admin-only screens out of a session without a known role", () => {
    const ids = buildNavGroups({ user: { role: 'not-a-role' }, hasPermission: () => true }).flatMap((g) => g.items.map((i) => i.id))
    expect(ids).not.toContain('invites')
    expect(ids).not.toContain('tax-tables')
  })

  it('reads the canvas badges: approvals, invites, disputes, reports hub and fraud', () => {
    const badgeFor = makeBadgeFor({ approvals_waiting: 7, invites_open: 2, disputes_open: 1, reports_hub: 12, fraud_open: 1, team_reports_waiting: 3 }, 'super_admin')
    expect(badgeFor('approvals')).toBe(7)
    expect(badgeFor('invites')).toBe(2)
    expect(badgeFor('disputes')).toBe(1)
    expect(badgeFor('team-reports')).toBe(12)
    expect(badgeFor('fraud-cases')).toBe(1)
    // Other roles keep their own keys: no disputes badge, and Reports reads the manager's own team.
    const other = makeBadgeFor({ disputes_open: 1, reports_hub: 12, team_reports_waiting: 3 }, 'operations')
    expect(other('disputes')).toBe(0)
    expect(other('team-reports')).toBe(3)
  })
})

describe('Marketing menu (canvas 2026-10-13)', () => {
  const MK = [
    'campaigns.manage', 'consent.view', 'coupons.manage', 'site_promo.manage', 'promotions.manage', 'analytics.view', 'categories.manage',
    'zones.manage', 'hero_media.approve', 'event.approve',
  ]
  const auth = { user: { role: 'marketing' }, hasPermission: (c) => MK.includes(c) }
  const groups = buildNavGroups(auth)

  it('has exactly the canvas items in order (two group names differ so no group repeats an item)', () => {
    expect(groups.map((g) => [g.label, g.items.map((i) => i.label)])).toEqual([
      ['Messages', ['Campaigns', 'New campaign', 'Calendar', 'Templates']],
      ['Audiences', ['Segments', 'Consent & opt-outs']],
      ['On the site', ['Flash sales', 'Coupons', 'Banners', 'Featured listings']],
      ['Moderation', ['Hero approval', 'Events', 'Promotions']],
      ['Insights', ['Analytics', 'Campaign results']],
      ['Settings', ['Sender IDs & providers', 'Quiet hours & limits', 'Categories']],
      ['Reporting', ['Reports']],
    ])
    expect(groups.flatMap((g) => g.items)).toHaveLength(19)
  })

  it('offers no More tools: a screen the canvas leaves out stays reachable only by URL permission rules', () => {
    expect(groups.some((g) => g.id === 'more')).toBe(false)
    expect(PLACEHOLDER_TABS.marketing.size).toBe(0)
  })

  it('gates each screen on its permission and shows none to another role', () => {
    const ids = (a) => buildNavGroups(a).flatMap((g) => g.items.map((i) => i.id))
    expect(ids({ user: { role: 'marketing' }, hasPermission: (c) => c === 'promotions.manage' })).toEqual(['promotions', 'mk-quiet-hours', 'reports'])
    for (const role of ['super_admin', 'operations', 'support']) {
      expect(ids({ user: { role }, hasPermission: () => true }).filter((id) => id.startsWith('mk-'))).toEqual([])
    }
  })

  it('reads the promotions badge from the new staff-badges key', () => {
    expect(makeBadgeFor({ promotions_pending: 3, hero: 2, events: 1 }, 'marketing')('promotions')).toBe(3)
  })
})
