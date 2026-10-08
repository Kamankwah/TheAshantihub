import { describe, expect, it } from 'vitest'
import { D } from '../../theme.js'
import { chip } from '../panelStyles.js'

describe('chip', () => {
  it('tints a hex token with a translucent fill and border', () => {
    const style = chip(D.green)
    expect(style.background).toBe(`${D.green}1f`)
    expect(style.border).toBe(`1px solid ${D.green}55`)
  })

  it('gives rgba (neutral) tokens a solid fill and border, never appended alpha', () => {
    const style = chip(D.textFaint)
    expect(style.background).toBe(D.panelBg2)
    expect(style.border).toBe(`1px solid ${D.cardBorder}`)
    expect(JSON.stringify(style)).not.toMatch(/\)1f|\)55/)
  })
})
