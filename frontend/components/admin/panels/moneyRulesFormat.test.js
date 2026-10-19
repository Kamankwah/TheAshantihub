import { describe, expect, it } from 'vitest'
import { GROUPS, groupSettings } from './moneyRulesFormat.js'

describe('Riders group', () => {
  it('GROUPS lists rider_withdrawals_per_day under Riders', () => {
    const riders = GROUPS.find(([title]) => title === 'Riders')
    expect(riders[1]).toEqual(['rider_commission_bp', 'rider_withdrawals_per_day'])
  })

  it('groupSettings never sends it to Other', () => {
    const settings = [
      { key: 'rider_commission_bp', value: 1000 },
      { key: 'rider_withdrawals_per_day', value: 3 },
    ]
    const grouped = groupSettings(settings)
    expect(grouped.map(([title]) => title)).toEqual(['Riders'])
    expect(grouped[0][1].map((s) => s.key)).toEqual(['rider_commission_bp', 'rider_withdrawals_per_day'])
  })
})
