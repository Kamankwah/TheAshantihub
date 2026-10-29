import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ScrollSpyTabs from './components/ScrollSpyTabs.jsx'

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'specs', label: 'Specs' },
  { id: 'reviews', label: 'Reviews' },
]

function renderTabs(props = {}) {
  return render(
    <ScrollSpyTabs
      tabs={TABS}
      renderSection={(tabId) => <div>Section content: {tabId}</div>}
      {...props}
    />,
  )
}

// jsdom has no real IntersectionObserver/scroll geometry — a light stub is
// enough to exercise "the component doesn't crash and click-to-set-active
// works" per the phase brief; real scroll-triggered highlighting is the
// Playwright browser check's job, not this file's.
class FakeIntersectionObserver {
  constructor(callback) {
    this.callback = callback
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe('ScrollSpyTabs', () => {
  beforeEach(() => {
    window.IntersectionObserver = FakeIntersectionObserver
    // scrollIntoView isn't implemented in jsdom.
    Element.prototype.scrollIntoView = vi.fn()
  })

  afterEach(() => {
    delete window.IntersectionObserver
    vi.restoreAllMocks()
  })

  it('renders null when tabs is empty', () => {
    const { container } = render(<ScrollSpyTabs tabs={[]} renderSection={() => null} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders every tab and every section', () => {
    renderTabs()
    TABS.forEach((tab) => {
      expect(screen.getByRole('tab', { name: tab.label })).toBeInTheDocument()
    })
    expect(screen.getByText('Section content: overview')).toBeInTheDocument()
    expect(screen.getByText('Section content: specs')).toBeInTheDocument()
    expect(screen.getByText('Section content: reviews')).toBeInTheDocument()
  })

  it('the first tab is active by default', () => {
    renderTabs()
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Specs' })).toHaveAttribute('aria-selected', 'false')
  })

  it('clicking a tab sets it active and scrolls its section into view', () => {
    renderTabs()
    fireEvent.click(screen.getByRole('tab', { name: 'Specs' }))
    expect(screen.getByRole('tab', { name: 'Specs' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'false')
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled()
  })

  it('does not crash when IntersectionObserver is unavailable', () => {
    delete window.IntersectionObserver
    expect(() => renderTabs()).not.toThrow()
  })

  it('renders a trailing slot at the bar, given the active tab when it is a function', () => {
    renderTabs({ trailing: (active) => (active === 'overview' ? null : <span>Mini: {active}</span>) })
    expect(screen.queryByText(/Mini:/)).toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: 'Reviews' }))
    expect(screen.getByText('Mini: reviews')).toBeInTheDocument()
    // The slot sits beside the tab list, not inside it.
    expect(screen.getByRole('tablist')).not.toContainElement(screen.getByText('Mini: reviews'))
  })

  it('an external tab scrolls to a section the page rendered itself and renders no section of its own', () => {
    const scrolled = []
    Element.prototype.scrollIntoView = vi.fn(function scroll() { scrolled.push(this.id) })
    render(
      <div>
        <div id="hero">The page's own top section</div>
        <ScrollSpyTabs
          tabs={[{ id: 'hero', label: 'Top', external: true }, { id: 'specs', label: 'Specs' }]}
          renderSection={(tabId) => <div>Section content: {tabId}</div>}
        />
      </div>,
    )
    expect(screen.queryByText('Section content: hero')).toBeNull()
    expect(screen.getByText('Section content: specs')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Specs' }))
    fireEvent.click(screen.getByRole('tab', { name: 'Top' }))
    expect(scrolled).toEqual(['specs', 'hero'])
  })

  it('the theme tone draws the bar with theme tokens, the default stays the dark bar', () => {
    const { unmount } = renderTabs({ tone: 'theme' })
    const themed = screen.getByRole('tablist').parentElement.getAttribute('style')
    expect(themed).toContain('var(--ah-canvas')
    expect(screen.getByRole('tab', { name: 'Specs' }).getAttribute('style')).not.toMatch(/color:\s*white/)
    unmount()
    renderTabs()
    expect(screen.getByRole('tab', { name: 'Specs' }).getAttribute('style')).toMatch(/color:\s*white/)
  })
})
