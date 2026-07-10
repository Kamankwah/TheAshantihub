import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

describe('test framework smoke test', () => {
  it('runs plain assertions', () => {
    expect(1 + 1).toBe(2)
  })

  it('renders a component with React Testing Library', () => {
    render(<div>Hello AshantiHub</div>)
    expect(screen.getByText('Hello AshantiHub')).toBeInTheDocument()
  })
})
