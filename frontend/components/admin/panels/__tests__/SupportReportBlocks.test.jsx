import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SystemSections } from '../reportParts.jsx'

describe('Support report blocks', () => {
  it('draws Calls by outcome as bars from the real counts', () => {
    const sections = [
      { key: 'support_desk', title: 'Conversations', rows: [{ label: 'Conversations handled', value: 14 }, { label: 'First reply, average (clock time)', value: '9 min' }] },
      { key: 'support_calls_outcome', title: 'Calls by outcome', rows: [{ label: 'Connected', value: 4 }, { label: 'No answer', value: 1 }, { label: 'Busy', value: 0 }], summary: '5 calls logged.' },
    ]
    render(<SystemSections sections={sections} live />)
    const block = screen.getByText('Calls by outcome').parentElement
    expect(within(block).getByRole('img', { name: 'Connected: 4' })).toBeInTheDocument()
    expect(within(block).getByRole('img', { name: 'Busy: 0' })).toBeInTheDocument()
    expect(within(block).getByText('5 calls logged.')).toBeInTheDocument()
    expect(screen.getByText('First reply, average (clock time)')).toBeInTheDocument()
  })
})
