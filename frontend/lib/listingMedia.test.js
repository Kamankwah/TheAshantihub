import { describe, expect, test } from 'vitest'
import { mediaOf } from './listingMedia.js'

describe('mediaOf', () => {
  test('main photo comes first, then photos in order', () => {
    const m = mediaOf({
      main_photo: 'https://x/main.jpg',
      photos: [{ id: 2, image: 'https://x/b.jpg', order: 1 }, { id: 1, image: 'https://x/a.jpg', order: 0 }],
    })
    expect(m.map((x) => x.url)).toEqual(['https://x/main.jpg', 'https://x/a.jpg', 'https://x/b.jpg'])
    expect(m.every((x) => x.kind === 'image' && x.youtube_id === null)).toBe(true)
    expect(m.map((x) => x.position)).toEqual([0, 1, 2])
  })

  test('does not repeat the main photo when it is also in photos', () => {
    const m = mediaOf({ main_photo: 'https://x/a.jpg', photos: [{ id: 1, image: 'https://x/a.jpg', order: 0 }] })
    expect(m).toHaveLength(1)
  })

  test('uploaded video and youtube video', () => {
    const m = mediaOf({
      videos: [
        { id: 2, kind: 'upload', url: 'https://x/v.mp4', poster: 'https://x/v.jpg', position: 0 },
        { id: 3, kind: 'youtube', youtube_id: 'dQw4w9WgXcQ', poster: null, position: 1 },
      ],
    })
    expect(m[0]).toMatchObject({ kind: 'video', url: 'https://x/v.mp4', thumb_url: 'https://x/v.jpg', youtube_id: null })
    expect(m[1]).toMatchObject({ kind: 'youtube', youtube_id: 'dQw4w9WgXcQ', url: null })
  })

  test('a converting video without a web file is skipped', () => {
    const m = mediaOf({ videos: [{ id: 2, kind: 'upload', url: null, poster: null, position: 0 }, { id: 3, kind: 'upload', position: 1 }] })
    expect(m).toEqual([])
  })

  test('empty item gives an empty list', () => {
    expect(mediaOf({})).toEqual([])
    expect(mediaOf(null)).toEqual([])
    expect(mediaOf({ main_photo: null, photos: [], videos: [] })).toEqual([])
  })

  test('caps at 9 images and 2 videos', () => {
    const photos = Array.from({ length: 12 }, (_, i) => ({ id: i, image: `https://x/${i}.jpg`, order: i }))
    const videos = Array.from({ length: 4 }, (_, i) => ({ id: i, kind: 'upload', url: `https://x/${i}.mp4`, position: i }))
    const m = mediaOf({ main_photo: 'https://x/main.jpg', photos, videos })
    expect(m.filter((x) => x.kind === 'image')).toHaveLength(9)
    expect(m.filter((x) => x.kind === 'video')).toHaveLength(2)
  })
})
