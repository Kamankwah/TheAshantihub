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
})
