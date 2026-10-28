import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { server } from '../../../../mocks/server.js'
import AskOwnerAgain from '../AskOwnerAgain.jsx'

const API = 'http://localhost:8000'
const URL_ = `${API}/api/portfolio/businesses/12/confirmation/registration/`

describe('AskOwnerAgain', () => {
  it('shows nothing unless the server says asking again would be accepted', () => {
    const { container } = render(<AskOwnerAgain businessId="12" confirmation={{ state: 'waiting', can_ask_again: false }} />)
    expect(container).toBeEmptyDOMElement()
    expect(render(<AskOwnerAgain businessId="12" confirmation={null} />).container).toBeEmptyDOMElement()
  })

  it.each([['lapsed', /expired/], ['declined', /declined/], ['not_sent', /has not gone out/]])('offers the action when the owner state is %s, and says why', (state, why) => {
    render(<AskOwnerAgain businessId="12" confirmation={{ state, can_ask_again: true }} />)
    expect(screen.getByRole('button', { name: 'Ask the owner to confirm again' })).toBeInTheDocument()
    expect(screen.getByText(why)).toBeInTheDocument()
  })

  it('posts, refetches and reports the honest result line (a simulated text is never called sent)', async () => {
    const onDone = vi.fn()
    let hit = 0
    server.use(http.post(URL_, () => { hit += 1; return HttpResponse.json({ state: 'awaiting_owner', sent_to_masked: '024 *** 1234', expires_at: '2026-11-04T10:00:00Z', send_note: 'Not sent: texts are simulated' }) }))
    render(<AskOwnerAgain businessId="12" confirmation={{ state: 'lapsed', can_ask_again: true }} onDone={onDone} />)
    fireEvent.click(screen.getByRole('button', { name: 'Ask the owner to confirm again' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Not sent: texts are simulated (024 *** 1234)')
    expect(screen.getByRole('status')).not.toHaveTextContent('Text sent')
    expect(hit).toBe(1)
    await waitFor(() => expect(onDone).toHaveBeenCalled())
  })

  it('shows the server reason when refused and never shows a link or token', async () => {
    server.use(http.post(URL_, () => HttpResponse.json({ detail: 'A link can be resent three times a day. Try again tomorrow.', code: 'rate_limited' }, { status: 429 })))
    const { container } = render(<AskOwnerAgain businessId="12" confirmation={{ state: 'declined', can_ask_again: true }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Ask the owner to confirm again' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('A link can be resent three times a day. Try again tomorrow.')
    expect(container.textContent).not.toMatch(/token|http|confirm#/i)
  })
})
