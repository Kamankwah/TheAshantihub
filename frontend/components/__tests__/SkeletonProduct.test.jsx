import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SkeletonProduct } from '../Skeleton.jsx'

describe('SkeletonProduct', () => {
  it('is one polite status region that names what is loading', () => {
    render(<SkeletonProduct />)
    const status = screen.getByRole('status')
    expect(status).toHaveTextContent('Loading this product…')
    expect(status).toHaveAttribute('aria-live', 'polite')
  })
})
