import { describe, expect, test } from 'vitest'
import { clampPan, distance, isSwipe, nextScale } from './pinchMath.js'

describe('pinchMath', () => {
  test('test_scale_follows_the_finger_distance_ratio', () => {
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5)
    expect(nextScale(1, 100, 200)).toBe(2)
    expect(nextScale(2, 100, 150)).toBe(3)
    expect(nextScale(2, 100, 50)).toBe(1)
  })

  test('test_scale_is_clamped_between_1_and_4', () => {
    expect(nextScale(1, 100, 10)).toBe(1)
    expect(nextScale(3, 100, 900)).toBe(4)
    expect(nextScale(1, 0, 50)).toBe(1) // zero start distance never divides
    expect(nextScale(1, 100, 900, { min: 1, max: 2 })).toBe(2)
  })

  test('test_pan_cannot_move_the_image_off_its_box', () => {
    const box = { w: 400, h: 300 }
    expect(clampPan({ x: 999, y: -999 }, 2, box)).toEqual({ x: 200, y: -150 })
    expect(clampPan({ x: 50, y: 20 }, 2, box)).toEqual({ x: 50, y: 20 })
    expect(clampPan({ x: 50, y: 20 }, 1, box)).toEqual({ x: 0, y: 0 })
  })

  test('test_swipe_needs_50px_and_horizontal_dominance', () => {
    expect(isSwipe(-60, 10)).toBe(true)
    expect(isSwipe(60, -10)).toBe(true)
    expect(isSwipe(-49, 0)).toBe(false)
    expect(isSwipe(-60, 80)).toBe(false)
    expect(isSwipe(-60, 60)).toBe(false)
  })

  test('test_no_swipe_while_zoomed', () => {
    expect(isSwipe(-200, 0, { scale: 2 })).toBe(false)
    expect(isSwipe(-200, 0, { scale: 1 })).toBe(true)
  })
})
