import { afterEach, describe, expect, test, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import ProductGallery from '../shop/ProductGallery.jsx'
import { installMatchMedia } from '../../test/matchMedia.js'

const img = (n) => ({ id: n, kind: 'image', url: `https://x/img${n}.jpg`, thumb_url: `https://x/t${n}.jpg`, youtube_id: null, position: n })
const upload = { id: 20, kind: 'video', url: 'https://x/v.mp4', thumb_url: 'https://x/v.jpg', youtube_id: null, position: 20 }
const yt = { id: 21, kind: 'youtube', url: null, thumb_url: null, youtube_id: 'dQw4w9WgXcQ', position: 21 }
const three = [img(1), img(2), img(3)]

let mm
afterEach(() => { mm?.restore(); mm = null; vi.restoreAllMocks() })

const mainImg = () => screen.getByTestId('gallery-main-image')

describe('ProductGallery', () => {
  test('test_renders_main_image_and_one_thumbnail_per_image', () => {
    render(<ProductGallery media={three} title="Kente" />)
    expect(mainImg()).toHaveAttribute('src', 'https://x/img1.jpg')
    expect(screen.getAllByTestId('gallery-thumb')).toHaveLength(3)
    expect(screen.getByText('Click to see full view')).toBeInTheDocument()
    expect(screen.queryByText(/Videos \(/)).toBeNull()
  })

  test('test_hover_shows_the_zoom_pane_and_leave_hides_it', () => {
    mm = installMatchMedia(1200)
    render(<ProductGallery media={three} title="Kente" />)
    const box = screen.getByTestId('gallery-main')
    expect(screen.queryByTestId('zoom-pane')).toBeNull()
    fireEvent.mouseEnter(box)
    fireEvent.mouseMove(box, { clientX: 50, clientY: 50 })
    expect(screen.getByTestId('zoom-pane')).toBeInTheDocument()
    fireEvent.mouseLeave(box)
    expect(screen.queryByTestId('zoom-pane')).toBeNull()
  })

  test('test_no_zoom_pane_when_hover_is_unavailable', () => {
    window.matchMedia = (q) => ({ media: q, matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })
    render(<ProductGallery media={three} title="Kente" />)
    fireEvent.mouseEnter(screen.getByTestId('gallery-main'))
    expect(screen.queryByTestId('zoom-pane')).toBeNull()
  })

  test('test_clicking_a_thumbnail_changes_the_main_image', () => {
    render(<ProductGallery media={three} title="Kente" />)
    fireEvent.click(screen.getAllByTestId('gallery-thumb')[2])
    expect(mainImg()).toHaveAttribute('src', 'https://x/img3.jpg')
  })

  test('test_variant_image_replaces_the_main_image', () => {
    const { rerender } = render(<ProductGallery media={three} title="Kente" activeVariantImage={null} />)
    expect(mainImg()).toHaveAttribute('src', 'https://x/img1.jpg')
    rerender(<ProductGallery media={three} title="Kente" activeVariantImage="https://x/variant.jpg" />)
    expect(mainImg()).toHaveAttribute('src', 'https://x/variant.jpg')
    rerender(<ProductGallery media={three} title="Kente" activeVariantImage={null} />)
    expect(mainImg()).toHaveAttribute('src', 'https://x/img1.jpg')
  })

  test('test_click_opens_the_lightbox_at_that_image', () => {
    const onOpen = vi.fn()
    render(<ProductGallery media={three} title="Kente" onOpen={onOpen} />)
    fireEvent.click(screen.getAllByTestId('gallery-thumb')[1])
    fireEvent.click(screen.getByRole('button', { name: /full view/i }))
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(within(dialog).getByTestId('lightbox-slide')).toHaveAttribute('src', 'https://x/img2.jpg')
    expect(onOpen).toHaveBeenCalledWith(1)
  })

  test('test_lightbox_arrows_and_keyboard_move_between_slides', () => {
    render(<ProductGallery media={three} title="Kente" />)
    fireEvent.click(screen.getByRole('button', { name: /full view/i }))
    const slide = () => screen.getByTestId('lightbox-slide')
    expect(slide()).toHaveAttribute('src', 'https://x/img1.jpg')
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(slide()).toHaveAttribute('src', 'https://x/img2.jpg')
    fireEvent.keyDown(document.activeElement, { key: 'ArrowRight' })
    expect(slide()).toHaveAttribute('src', 'https://x/img3.jpg')
    fireEvent.keyDown(document.activeElement, { key: 'ArrowLeft' })
    expect(slide()).toHaveAttribute('src', 'https://x/img2.jpg')
    fireEvent.click(screen.getByRole('button', { name: 'Previous' }))
    expect(slide()).toHaveAttribute('src', 'https://x/img1.jpg')
    fireEvent.click(within(screen.getByRole('dialog')).getAllByTestId('lightbox-thumb')[2])
    expect(slide()).toHaveAttribute('src', 'https://x/img3.jpg')
  })

  test('test_escape_closes_and_returns_focus', () => {
    render(<ProductGallery media={three} title="Kente" />)
    const opener = screen.getByRole('button', { name: /full view/i })
    opener.focus()
    fireEvent.click(opener)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true)
    fireEvent.keyDown(document.activeElement, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(opener).toHaveFocus()
  })

  test('backdrop click closes', () => {
    render(<ProductGallery media={three} title="Kente" />)
    fireEvent.click(screen.getByRole('button', { name: /full view/i }))
    fireEvent.click(screen.getByTestId('lightbox-backdrop'))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  test('test_videos_tab_lists_uploaded_and_youtube_and_is_hidden_when_none', () => {
    const { unmount } = render(<ProductGallery media={[...three, upload, yt]} title="Kente" />)
    fireEvent.click(screen.getByRole('button', { name: /Videos \(2\)/ }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByRole('tab', { name: /^Videos/ })).toHaveAttribute('aria-selected', 'true')
    expect(within(dialog).getAllByTestId('lightbox-thumb')).toHaveLength(2)
    const video = dialog.querySelector('video')
    expect(video).toHaveAttribute('poster', 'https://x/v.jpg')
    expect(video).toHaveAttribute('preload', 'metadata')
    fireEvent.click(within(dialog).getByRole('tab', { name: /^Images/ }))
    expect(within(dialog).getAllByTestId('lightbox-thumb')).toHaveLength(3)
    unmount()

    render(<ProductGallery media={three} title="Kente" />)
    fireEvent.click(screen.getByRole('button', { name: /full view/i }))
    expect(screen.queryByRole('tab', { name: /^Videos/ })).toBeNull()
  })

  test('test_changing_slide_pauses_the_playing_video', () => {
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
    render(<ProductGallery media={[upload, { ...upload, id: 22, url: 'https://x/v2.mp4' }]} title="Kente" />)
    fireEvent.click(screen.getByRole('button', { name: /Videos \(2\)/ }))
    pause.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(pause).toHaveBeenCalled()
    expect(screen.getByRole('dialog').querySelector('video')).toHaveAttribute('src', 'https://x/v2.mp4')
  })

  test('youtube embeds via nocookie', () => {
    render(<ProductGallery media={[yt]} title="Kente" />)
    fireEvent.click(screen.getByRole('button', { name: /Videos \(1\)/ }))
    expect(screen.getByRole('dialog').querySelector('iframe')).toHaveAttribute('src', 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ')
  })

  test('test_bad_youtube_id_renders_no_iframe', () => {
    render(<ProductGallery media={[{ ...yt, youtube_id: 'x"><script>' }]} title="Kente" />)
    fireEvent.click(screen.getByRole('button', { name: /Videos \(1\)/ }))
    expect(screen.getByRole('dialog').querySelector('iframe')).toBeNull()
  })

  test('test_empty_media_renders_a_placeholder_not_a_broken_image', () => {
    const { container } = render(<ProductGallery media={[]} title="Kente" />)
    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByText('No photo yet')).toBeInTheDocument()
    expect(screen.queryByText('Click to see full view')).toBeNull()
  })
})
