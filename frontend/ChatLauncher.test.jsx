import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import ChatLauncher from './components/ChatLauncher.jsx'

describe('ChatLauncher', () => {
  it('calls onOpen when clicked', () => {
    const onOpen = vi.fn()
    render(<ChatLauncher onOpen={onOpen} />)
    fireEvent.click(screen.getByLabelText('Open messages'))
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('shows the unread count badge when there are unread messages', () => {
    render(<ChatLauncher onOpen={vi.fn()} unreadMessages={3} />)
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('omits the badge when there are no unread messages', () => {
    render(<ChatLauncher onOpen={vi.fn()} unreadMessages={0} />)
    expect(screen.queryByText('0')).not.toBeInTheDocument()
  })
})
