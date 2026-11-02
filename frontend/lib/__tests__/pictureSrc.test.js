import { describe, expect, it } from 'vitest'
import { pictureProps } from '../pictureSrc.js'

describe('pictureProps', () => {
  it('uses the small copies with a srcset when they exist', () => {
    const props = pictureProps({ image: 'o.jpg', image_variants: { thumb: 't.webp', medium: 'm.webp', large: 'l.webp' } }, '120px')
    expect(props).toEqual({ src: 't.webp', srcSet: 't.webp 320w, m.webp 800w', sizes: '120px' })
  })
  it('falls back to the original when there are no copies, or a small original stood in for them', () => {
    expect(pictureProps({ image: 'o.jpg', image_variants: null })).toEqual({ src: 'o.jpg' })
    expect(pictureProps({ image: 'o.jpg', image_variants: { thumb: 'o.jpg', medium: 'o.jpg', large: 'o.jpg' } })).toEqual({ src: 'o.jpg' })
  })
  it('is null without a picture', () => {
    expect(pictureProps({ image: null })).toBeNull()
  })
})
