import { describe, expect, it } from 'vitest'
import { walletMessage, refusalCode } from '../walletErrors.js'
import { formatGhs, isPlausibleAmount, pesewasToGhs } from '../walletMoney.js'

const err = (status, body) => Object.assign(new Error('x'), { status, body })

describe('walletMessage', () => {
  it('test_ledger_off_text', () => {
    expect(walletMessage(err(409, { detail: 'off', code: 'ledger_off' }))).toEqual({ text: "Wallets aren't switched on yet.", kind: 'off' })
    expect(refusalCode(err(409, { code: 'ledger_off' }))).toBe('ledger_off')
    expect(refusalCode(new Error('x'))).toBeNull()
  })

  it('test_server_detail_wins', () => {
    expect(walletMessage(err(400, { detail: 'Not enough in your wallet.' }))).toEqual({ text: 'Not enough in your wallet.', kind: 'error' })
    expect(walletMessage(err(400, { amount: ['Enter a valid amount.'] })).text).toBe('Enter a valid amount.')
    expect(walletMessage(new Error('boom'))).toEqual({ text: 'Something went wrong. Try again.', kind: 'error' })
  })

  it('test_step_up_cancelled_text', () => {
    expect(walletMessage(err(403, { code: 'step_up_required', detail: 'Code needed.' }))).toEqual({
      text: 'We need to confirm it is you. Try again and enter the code.', kind: 'stepup',
    })
  })
})

describe('walletMoney', () => {
  it('test_plausible_amounts', () => {
    for (const ok of ['50', '50.5', '50.25']) expect(isPlausibleAmount(ok)).toBe(true)
    for (const bad of ['', '0', '0.00', '1.234', 'abc', '-5', '1e3', '12345678901', '١٢']) expect(isPlausibleAmount(bad)).toBe(false)
    expect(isPlausibleAmount(undefined)).toBe(false)
  })

  it('test_formatGhs_never_uses_float_maths', () => {
    expect(formatGhs('0.10')).toBe('GH₵ 0.10')
    expect(formatGhs('99999999.99')).toBe('GH₵ 99,999,999.99')
    expect(formatGhs('1250')).toBe('GH₵ 1,250.00')
    expect(formatGhs('1250.5')).toBe('GH₵ 1,250.50')
    expect(formatGhs(null)).toBe('')
    expect(pesewasToGhs(12345)).toBe('GH₵ 123.45')
    expect(pesewasToGhs(5)).toBe('GH₵ 0.05')
  })
})
