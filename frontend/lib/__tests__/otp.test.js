import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEVICE_KEY, clearDeviceToken, getDeviceToken, isOtpChallenge, otpCode, setDeviceToken,
} from '../otp.js'

afterEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
})

describe('device token storage', () => {
  it('keeps the token in its own key', () => {
    setDeviceToken('dev-1')
    expect(localStorage.getItem('ashantihub.deviceToken')).toBe('dev-1')
    expect(DEVICE_KEY).toBe('ashantihub.deviceToken')
    expect(getDeviceToken()).toBe('dev-1')
    clearDeviceToken()
    expect(getDeviceToken()).toBeNull()
  })

  it('does not throw when storage does', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('blocked') })
    expect(getDeviceToken()).toBeNull()
    expect(() => setDeviceToken('x')).not.toThrow()
    expect(() => clearDeviceToken()).not.toThrow()
  })
})

describe('isOtpChallenge', () => {
  it('is true for a code or authenticator challenge without a token', () => {
    expect(isOtpChallenge({ otp_required: true, mfa_token: 'm' })).toBe(true)
    expect(isOtpChallenge({ two_factor_required: true, mfa_token: 'm' })).toBe(true)
  })
  it('is false for a signed-in body, empty answers and setup challenges', () => {
    expect(isOtpChallenge({ token: 't', otp_required: true })).toBe(false)
    expect(isOtpChallenge(null)).toBe(false)
    expect(isOtpChallenge({ two_factor_setup_required: true })).toBe(false)
  })
})

describe('otpCode', () => {
  it('reads the code off an error body', () => {
    expect(otpCode({ body: { code: 'wrong_code' } })).toBe('wrong_code')
    expect(otpCode(new Error('x'))).toBeUndefined()
    expect(otpCode(undefined)).toBeUndefined()
  })
})
