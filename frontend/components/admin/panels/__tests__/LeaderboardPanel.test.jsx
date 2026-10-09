import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../../../mocks/server.js'
import LeaderboardPanel, { headline, ordinal, summary } from '../LeaderboardPanel.jsx'

const API = 'http://localhost:8000'
const row = (name, activations, rank, over = {}) => ({ id: rank, name, areas: [], activations, leave_days: 0, rank, is_me: false, most_improved: false, ...over })
const board = (over = {}) => ({
  month: '2026-10', as_of: '2026-10-07', lead: { id: 2, name: 'Ama Boateng' },
  rows: [
    row('Efua Mensah', 9, 1, { areas: ['Adum', 'Kejetia'] }),
    row('Abena Darko', 7, 2, { areas: ['Suame', 'Tafo'] }),
    row('Kwame Asante', 5, 3, { areas: ['Asafo', 'Bantama'], is_me: true }),
    row('Kofi Boadu', 4, 4, { areas: ['Ahodwo', 'Nhyiaeso'], leave_days: 2 }),
    row('Yaw Owusu', 3, 5, { areas: ['Bonwire', 'Ejisu'], most_improved: true }),
  ],
  team_total: 28, my_rank: 3, my_count: 5, gap: { name: 'Abena Darko', count: 2 },
  most_improved: { name: 'Yaw Owusu', now: 3, then: 1, as_of: '2026-10-07', then_month: '2026-09' },
  ...over,
})
function renderPanel(data = board()) {
  server.use(http.get(`${API}/api/portfolio/leaderboard/`, () => HttpResponse.json(data)))
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={queryClient}><LeaderboardPanel /></QueryClientProvider>)
}

describe('LeaderboardPanel', () => {
  it('shows the team heading, the personal card and the team total', async () => {
    renderPanel()
    expect(await screen.findByText("Ama Boateng's team · October")).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: "You're 3rd so far" })).toBeInTheDocument()
    expect(screen.getByText('5 activations so far. 2 more puts you level with Abena Darko.')).toBeInTheDocument()
    expect(screen.getByText('Team total: 28 activations by 7 October')).toBeInTheDocument()
  })

  it('ranks the list with bars, highlights my row, and shows leave days and the improved tag', async () => {
    renderPanel()
    const list = await screen.findByRole('list')
    const items = within(list).getAllByRole('listitem')
    expect(items).toHaveLength(5)
    expect(items[2]).toHaveTextContent('Kwame Asante (you)')
    expect(items[2]).toHaveAttribute('aria-current', 'true')
    expect(items[2]).toHaveTextContent('Asafo & Bantama')
    expect(items[3]).toHaveTextContent('Ahodwo & Nhyiaeso · 2 leave days')
    expect(items[4]).toHaveTextContent('Bonwire & Ejisu · Most improved')
    expect(within(items[0]).getByRole('progressbar')).toHaveStyle({ overflow: 'hidden' })
    expect(within(items[2]).getByRole('progressbar').firstChild).toHaveStyle({ width: '56%' })
  })

  it('shows the most improved card only when the server sends one', async () => {
    renderPanel()
    expect(await screen.findByRole('heading', { name: 'Most improved: Yaw Owusu' })).toBeInTheDocument()
    expect(screen.getByText('3 activations by 7 October, up from 1 at the same point in September. Well done, Yaw.')).toBeInTheDocument()
  })

  it('hides it otherwise, never invents a prediction, and keeps the footer', async () => {
    renderPanel(board({ most_improved: null }))
    await screen.findByRole('heading', { name: "You're 3rd so far" })
    expect(screen.queryByText(/Most improved:/)).not.toBeInTheDocument()
    expect(screen.queryByText(/could be one/)).not.toBeInTheDocument()
    expect(screen.getByText(/An activation is a business you registered with KYC approved and its first listing live\. Leave days and holidays never count against anyone\./)).toBeInTheDocument()
  })

  it('handles an empty month and a lone scout', async () => {
    renderPanel(board({ rows: [row('Kwame Asante', 0, 1, { is_me: true })], team_total: 0, my_rank: 1, my_count: 0, gap: null, most_improved: null, lead: null }))
    expect(await screen.findByText('Your team · October')).toBeInTheDocument()
    expect(screen.getByText('No activations yet this month.')).toBeInTheDocument()
  })
})

describe('leaderboard copy helpers', () => {
  it('makes ordinals, ties and the top spot', () => {
    expect([1, 2, 3, 4, 11, 12, 21, 22].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '21st', '22nd'])
    const tied = board({ rows: [row('A', 2, 1), row('B', 1, 2, { is_me: true }), row('C', 1, 2)], my_rank: 2, my_count: 1 })
    expect(headline(tied)).toBe("You're joint 2nd so far")
    const top = board({ rows: [row('A', 2, 1, { is_me: true }), row('B', 1, 2)], my_rank: 1, my_count: 2, gap: null })
    expect(summary(top)).toBe("2 activations so far. You're at the top of the team.")
  })
})
