import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'

vi.mock('../../hooks/useBreakpoint.js', () => ({ default: vi.fn(() => 'desktop') }))
import useBreakpoint from '../../hooks/useBreakpoint.js'
import MobileGallery from '../shop/MobileGallery.jsx'
import ProductGallery from '../shop/ProductGallery.jsx'

const img = (n) => ({ id: n, kind: 'image', url: `https://x/img${n}.jpg`, thumb_url: `https://x/t${n}.jpg`, youtube_id: null, position: n })
const upload = { id: 20, kind: 'video', url: 'https://x/v.mp4', thumb_url: null, youtube_id: null, position: 20 }
const yt = { id: 21, kind: 'youtube', url: null, thumb_url: null, youtube_id: 'dQw4w9WgXcQ', position: 21 }
const three = [img(1), img(2), img(3)]

beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve())
  document.body.style.overflow = ''
})
afterEach(() => { vi.restoreAllMocks(); useBreakpoint.mockReturnValue('desktop'); document.body.style.overflow = '' })

const surface = () => screen.getByTestId('mg-surface')
const zoomEl = () => screen.getByTestId('mg-zoom')
// jsdom has no PointerEvent (fireEvent.pointerDown degrades to a plain Event
// and drops clientX/pointerId), so build a MouseEvent named like the pointer
// event and attach pointerId by hand. React listens for the event name only.
const ptr = (type) => (el, x, y, id = 1) => {
  const ev = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y })
  Object.defineProperty(ev, 'pointerId', { value: id })
  fireEvent(el, ev)
}
const down = ptr('pointerdown')
const move = ptr('pointermove')
const up = ptr('pointerup')

describe('MobileGallery', () => {
  test('test_tap_on_phone_opens_the_full_screen_gallery', () => {
    useBreakpoint.mockReturnValue('phone')
    render(<ProductGallery media={three} title="Kente" />)
    expect(screen.queryAllByTestId('gallery-thumb')).toHaveLength(0) // strip replaces the rail
    expect(screen.queryByTestId('mg-surface')).toBeNull()
    fireEvent.click(screen.getByLabelText('Open photo 1 full screen'))
    expect(screen.getByTestId('mg-surface')).toBeInTheDocument()
    expect(screen.queryByTestId('lightbox-backdrop')).toBeNull()
    expect(within(screen.getByRole('dialog')).getByText('1 / 3')).toBeInTheDocument()
  })

  test('test_desktop_tap_still_opens_the_lightbox', () => {
    render(<ProductGallery media={three} title="Kente" />)
    fireEvent.click(screen.getByLabelText('Click to see full view'))
    expect(screen.getByTestId('lightbox-backdrop')).toBeInTheDocument()
    expect(screen.queryByTestId('mg-surface')).toBeNull()
  })

  test('test_double_tap_toggles_zoom', () => {
    render(<MobileGallery media={three} startIndex={0} onClose={() => {}} />)
    expect(zoomEl().style.transform).toContain('scale(1)')
    down(surface(), 100, 100); up(surface(), 100, 100)
    down(surface(), 101, 100)
    expect(zoomEl().style.transform).toContain('scale(2)')
    up(surface(), 101, 100)
    down(surface(), 100, 100); up(surface(), 100, 100)
    down(surface(), 100, 100)
    expect(zoomEl().style.transform).toContain('scale(1)')
  })

  test('test_pinch_zooms_and_drag_pans_when_zoomed', () => {
    render(<MobileGallery media={three} startIndex={0} onClose={() => {}} />)
    down(surface(), 100, 100, 1); down(surface(), 200, 100, 2)
    move(surface(), 100, 100, 1); move(surface(), 300, 100, 2) // distance 100 -> 200
    expect(zoomEl().style.transform).toContain('scale(2)')
    up(surface(), 100, 100, 1); up(surface(), 300, 100, 2)
    down(surface(), 100, 100, 3)
    move(surface(), 130, 120, 3)
    expect(zoomEl().style.transform).toContain('translate(30px, 20px)')
  })

  test('test_swipe_left_goes_to_the_next_slide', () => {
    render(<MobileGallery media={three} startIndex={0} onClose={() => {}} />)
    down(surface(), 300, 200); move(surface(), 200, 205); up(surface(), 200, 205)
    expect(screen.getByText('2 / 3')).toBeInTheDocument()
    expect(screen.getByTestId('mg-slide')).toHaveAttribute('src', 'https://x/img2.jpg')
    down(surface(), 100, 200); move(surface(), 200, 200); up(surface(), 200, 200)
    expect(screen.getByText('1 / 3')).toBeInTheDocument()
  })

  test('test_no_swipe_while_zoomed_in', () => {
    render(<MobileGallery media={three} startIndex={0} onClose={() => {}} />)
    down(surface(), 100, 100); up(surface(), 100, 100); down(surface(), 100, 100); up(surface(), 100, 100)
    down(surface(), 300, 200); move(surface(), 200, 200); up(surface(), 200, 200)
    expect(screen.getByText('1 / 3')).toBeInTheDocument()
  })

  test('test_back_button_closes_the_gallery_without_pushing_again', () => {
    const onClose = vi.fn()
    const push = vi.spyOn(history, 'pushState')
    render(<MobileGallery media={three} startIndex={0} onClose={onClose} />)
    expect(push).toHaveBeenCalledTimes(1)
    act(() => { window.dispatchEvent(new PopStateEvent('popstate')) })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(push).toHaveBeenCalledTimes(1)
  })

  test('test_close_button_restores_scroll_and_pops_our_entry', () => {
    document.body.style.overflow = 'auto'
    const onClose = vi.fn()
    const back = vi.spyOn(history, 'back').mockImplementation(() => {})
    render(<MobileGallery media={three} startIndex={0} onClose={onClose} />)
    expect(document.body.style.overflow).toBe('hidden')
    fireEvent.click(screen.getByLabelText('Close'))
    expect(document.body.style.overflow).toBe('auto')
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(back).toHaveBeenCalledTimes(1)
  })

  test('test_close_does_not_go_back_when_our_entry_is_no_longer_current', () => {
    const back = vi.spyOn(history, 'back').mockImplementation(() => {})
    render(<MobileGallery media={three} startIndex={0} onClose={() => {}} />)
    history.pushState({ other: true }, '')
    fireEvent.click(screen.getByLabelText('Close'))
    expect(back).not.toHaveBeenCalled()
  })

  test('test_unmount_restores_scroll', () => {
    document.body.style.overflow = 'scroll'
    vi.spyOn(history, 'back').mockImplementation(() => {})
    const { unmount } = render(<MobileGallery media={three} startIndex={0} onClose={() => {}} />)
    unmount()
    expect(document.body.style.overflow).toBe('scroll')
  })

  test('test_videos_get_controls_and_changing_slide_pauses_them', () => {
    const pause = HTMLMediaElement.prototype.pause
    render(<MobileGallery media={[upload, yt, img(1)]} startIndex={0} onClose={() => {}} />)
    const v = screen.getByTestId('mg-slide')
    expect(v.tagName).toBe('VIDEO')
    expect(v).toHaveAttribute('controls')
    fireEvent.click(screen.getByLabelText('Next'))
    expect(pause).toHaveBeenCalled()
    const frame = document.querySelector('iframe')
    expect(frame.src).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ')
    expect(screen.getByText('2 / 3')).toBeInTheDocument()
  })

  test('test_a_bad_youtube_id_renders_no_iframe', () => {
    render(<MobileGallery media={[{ ...yt, youtube_id: 'x" onload="y' }]} startIndex={0} onClose={() => {}} />)
    expect(document.querySelector('iframe')).toBeNull()
    expect(screen.getByText("This video can't be shown.")).toBeInTheDocument()
  })
})
