import { describe, expect, test } from 'vitest'
import { lensRect, paneOffset } from './zoomMath.js'

const box = { w: 400, h: 400 }
const pane = { w: 400, h: 400 }

describe('zoomMath', () => {
  test('test_lens_is_clamped_to_the_image_box', () => {
    // 2.5x: lens is pane / 2.5 = 160 square, centred on the cursor
    expect(lensRect(box, { x: 200, y: 200 }, 2.5, pane)).toEqual({ x: 120, y: 120, w: 160, h: 160 })
    expect(lensRect(box, { x: 0, y: 0 }, 2.5, pane)).toEqual({ x: 0, y: 0, w: 160, h: 160 })
    expect(lensRect(box, { x: 400, y: 400 }, 2.5, pane)).toEqual({ x: 240, y: 240, w: 160, h: 160 })
    expect(lensRect(box, { x: -50, y: 999 }, 2.5, pane)).toEqual({ x: 0, y: 240, w: 160, h: 160 })
  })

  test('test_pane_offset_scales_by_zoom', () => {
    const lens = lensRect(box, { x: 200, y: 200 }, 2.5, pane)
    expect(paneOffset(lens, box, 2.5)).toEqual({ x: -300, y: -300 })
    expect(paneOffset({ x: 0, y: 0, w: 160, h: 160 }, box, 2.5)).toEqual({ x: 0, y: 0 })
    expect(paneOffset({ x: 240, y: 240, w: 160, h: 160 }, box, 2.5)).toEqual({ x: -600, y: -600 })
  })
})
