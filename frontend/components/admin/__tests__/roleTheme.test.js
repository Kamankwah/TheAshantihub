import { describe, expect, it } from 'vitest'
import { ROLE_ACCENTS, ROLE_BADGE_TEXT } from '../theme.js'

// Every backend Role.NAME_CHOICES value (backend/accounts/models.py).
const ROLES = ['super_admin', 'operations', 'accountant', 'marketing', 'support', 'scout', 'delivery_manager', 'dispatch']

const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const expand = (hex) => (hex.length === 4 ? `#${[...hex.slice(1)].map((c) => c + c).join('')}` : hex)
const contrast = (a, b) => {
  const [hi, lo] = [luminance(expand(a)), luminance(expand(b))].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

describe('staff role theme', () => {
  it.each(ROLES)('%s has its own accent and an AA-legible chip text colour', (role) => {
    expect(ROLE_ACCENTS[role]).toMatch(/^#[0-9a-fA-F]{6}$/)
    expect(ROLE_BADGE_TEXT[role]).toBeTruthy()
    expect(contrast(ROLE_ACCENTS[role], ROLE_BADGE_TEXT[role])).toBeGreaterThanOrEqual(4.5)
  })

  it('gives every role a distinct accent', () => {
    const accents = ROLES.map((r) => ROLE_ACCENTS[r].toLowerCase())
    expect(new Set(accents).size).toBe(ROLES.length)
  })
})
