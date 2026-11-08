import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import AshantiHub from './App.jsx'

// Every public screen has exactly one main landmark, and a "Skip to main content" link reaches it.

function mountApp(path) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <AshantiHub />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  localStorage.clear()
  window.history.pushState({}, '', '/')
})

describe('page landmarks', () => {
  it.each([
    ['/about', 'About AshantiHub'],
    ['/contact', 'Get In Touch'],
    ['/privacy', 'Privacy Notice'],
  ])('%s has one main landmark and a skip link to it', async (path, heading) => {
    window.history.pushState({}, '', path)
    mountApp(path)
    await screen.findByRole('heading', { level: 1, name: new RegExp(heading) }, { timeout: 4000 })
    const mains = screen.getAllByRole('main')
    expect(mains).toHaveLength(1)
    expect(mains[0]).toHaveAttribute('id', 'main-content')
    const skip = screen.getByRole('link', { name: 'Skip to main content' })
    fireEvent.click(skip)
    expect(document.activeElement).toBe(mains[0])
  }, 10000)
})
