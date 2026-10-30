import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import WhenSection from '../WhenSection.jsx'

function setup(filters = {}) {
  const setFilters = vi.fn()
  render(<WhenSection filters={filters} setFilters={setFilters} />)
  return { applied: (n = 0, state = filters) => setFilters.mock.calls[n][0](state) }
}

describe('WhenSection', () => {
  it('lists Today, This week and This month as a radio group', () => {
    setup()
    expect(screen.getByRole('radiogroup', { name: 'When' })).toBeInTheDocument()
    expect(screen.getAllByRole('radio').map((r) => r.closest('label').textContent)).toEqual(['Today', 'This week', 'This month'])
    screen.getAllByRole('radio').forEach((r) => expect(r).not.toBeChecked())
  })

  it('selecting sets `when` to the option value only', () => {
    const { applied } = setup({ zone: 'Adum' })
    fireEvent.click(screen.getByRole('radio', { name: 'This week' }))
    expect(applied(0)).toStrictEqual({ zone: 'Adum', when: 'week' })
    fireEvent.click(screen.getByRole('radio', { name: 'Today' }))
    expect(applied(1)).toStrictEqual({ zone: 'Adum', when: 'today' })
  })

  it('shows the current value as checked', () => {
    setup({ when: 'month' })
    expect(screen.getByRole('radio', { name: 'This month' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Today' })).not.toBeChecked()
  })
})
