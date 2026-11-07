import { describe, it, expect } from 'vitest'
import { pictureProps, cardPhoto } from './responsiveImage.js'

const V = { thumb: 'https://x/t.webp', medium: 'https://x/m.webp', large: 'https://x/l.webp' }

describe('pictureProps', () => {
  it('builds a srcset from the three copies and defaults src to medium', () => {
    const p = pictureProps(V, 'https://x/o.jpg', { sizes: '(min-width: 900px) 25vw, 50vw' })
    expect(p.src).toBe('https://x/m.webp')
    expect(p.srcSet).toBe('https://x/t.webp 320w, https://x/m.webp 800w, https://x/l.webp 1600w')
    expect(p.sizes).toBe('(min-width: 900px) 25vw, 50vw')
    expect(p.loading).toBe('lazy')
    expect(p.decoding).toBe('async')
  })
  it('drops sizes the server did not make (they fall back to the same original URL)', () => {
    const small = { thumb: 'https://x/o.jpg', medium: 'https://x/o.jpg', large: 'https://x/o.jpg' }
    const p = pictureProps(small, 'https://x/o.jpg')
    expect(p.srcSet).toBeUndefined()
    expect(p.src).toBe('https://x/o.jpg')
  })
  it('uses the original alone when there are no variants', () => {
    expect(pictureProps(null, 'https://x/o.jpg')).toEqual({ src: 'https://x/o.jpg', loading: 'lazy', decoding: 'async' })
  })
  it('loads eagerly only when asked', () => {
    expect(pictureProps(V, 'o', { eager: true }).loading).toBe('eager')
  })
})

describe('cardPhoto', () => {
  it('prefers the main photo, else the first gallery photo, else null', () => {
    expect(cardPhoto({ main_photo: 'm', main_photo_variants: V, photos: [{ image: 'p' }] })).toEqual({ url: 'm', variants: V })
    expect(cardPhoto({ photos: [{ image: 'p', variants: V }] })).toEqual({ url: 'p', variants: V })
    expect(cardPhoto({ photos: [] })).toBeNull()
  })
})
