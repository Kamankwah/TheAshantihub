import { describe, expect, it } from 'vitest'
import { STAFF_GATE_MESSAGE, isStaffSession } from '../staffSession.js'

describe('isStaffSession', () => {
  it('recognises both user shapes the app passes around', () => {
    // App.jsx's camelCase `user` and useAuth()'s raw `auth.user`.
    expect(isStaffSession({ accountType: 'staff' })).toBe(true)
    expect(isStaffSession({ account_type: 'staff' })).toBe(true)
  })

  it('is false for guests, customers and business owners', () => {
    expect(isStaffSession(null)).toBe(false)
    expect(isStaffSession(undefined)).toBe(false)
    expect(isStaffSession({ accountType: 'customer' })).toBe(false)
    expect(isStaffSession({ account_type: 'business_owner' })).toBe(false)
  })
})

describe('STAFF_GATE_MESSAGE', () => {
  it('is the one approved wording', () => {
    expect(STAFF_GATE_MESSAGE).toBe("Staff accounts can't shop or sell. Sign out first.")
  })
})
