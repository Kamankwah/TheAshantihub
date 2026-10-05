import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import AshantiHub from './App.jsx'

// The cookie banner used to live only in React state, so it came back on
// every page load and the visitor's choice was never recorded. A choice must
// survive a reload (a fresh mount of the app).

function mountApp() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/']}>
        <AshantiHub />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

async function waitForHome() {
  await screen.findByText(/Ashanti Rising/i, {}, { timeout: 3000 })
}

afterEach(() => {
  localStorage.clear()
})

describe('cookie consent', () => {
  it(
    'shows the banner on a first visit',
    async () => {
      mountApp()
      await waitForHome()
      expect(screen.getByText(/AshantiHub uses cookies/)).toBeInTheDocument()
    },
    8000,
  )

  it(
    'remembers an "Essential Only" choice after a reload',
    async () => {
      const first = mountApp()
      await waitForHome()
      fireEvent.click(screen.getByRole('button', { name: 'Essential Only' }))
      first.unmount()

      mountApp()
      await waitForHome()
      expect(screen.queryByText(/AshantiHub uses cookies/)).not.toBeInTheDocument()
    },
    12000,
  )

  it(
    'remembers an "Accept All" choice after a reload',
    async () => {
      const first = mountApp()
      await waitForHome()
      fireEvent.click(screen.getByRole('button', { name: 'Accept All' }))
      first.unmount()

      mountApp()
      await waitForHome()
      expect(screen.queryByText(/AshantiHub uses cookies/)).not.toBeInTheDocument()
    },
    12000,
  )
})
