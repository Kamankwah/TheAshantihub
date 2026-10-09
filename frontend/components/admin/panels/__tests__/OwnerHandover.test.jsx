import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setStoredAuth } from '../../../../apiClient.js'
import { server } from '../../../../mocks/server.js'
import OwnerHandover from '../OwnerHandover.jsx'

const PASSWORD = 'akwaaba-2026'
const HANDOVER_URL = 'http://localhost:8000/api/portfolio/businesses/41/handover/'
const CLAIM_URL = 'http://localhost:8000/api/accounts/business-owners/claim/'
const inMinutes = (m) => new Date(Date.now() + m * 60000).toISOString()
const preview = (overrides = {}) => ({
  business_name: 'Asafo Hair & Beauty', owner_name: 'Gifty Asantewaa', login_phone: '••••••••••761',
  area: 'Asafo', gps_address: 'AK-112-0384', registered_by_name: 'Kwame Asante',
  registered_at: '2026-10-08T10:52:00Z', terms_version: 'September 2026', channel: 'handover',
  expires_at: inMinutes(30), email_on_file: 'gi•••@example.com', ...overrides,
})
afterEach(() => setStoredAuth(null))

function startHandover({ expiresAt = inMinutes(30), start } = {}) {
  const seen = { starts: 0, previewToken: null }
  server.use(
    http.post(HANDOVER_URL, () => {
      seen.starts += 1
      return start ? start() : HttpResponse.json({ token: 'handover-tok', expires_at: expiresAt }, { status: 201 })
    }),
    http.get(CLAIM_URL, ({ request }) => {
      seen.previewToken = new URL(request.url).searchParams.get('token')
      return HttpResponse.json(preview({ expires_at: expiresAt }))
    }),
  )
  return seen
}

// The shell's phone bar stands next to the hand-over, as it does in the app.
function renderHandover() {
  const onDone = vi.fn()
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const tree = (open) => (
    <QueryClientProvider client={queryClient}>
      <nav aria-label="Quick navigation"><button type="button">Calls</button></nav>
      {open && <OwnerHandover businessId={41} ownerFirstName="Gifty" scoutName="Kwame" onDone={onDone} />}
    </QueryClientProvider>
  )
  const utils = render(tree(true))
  return { ...utils, onDone, closeHandover: () => utils.rerender(tree(false)) }
}

function fillClaimForm({ email = '' } = {}) {
  fireEvent.click(screen.getByLabelText(/I have read and accept the AshantiHub Business Agreement/))
  fireEvent.change(screen.getByLabelText('Set your password'), { target: { value: PASSWORD } })
  fireEvent.change(screen.getByLabelText('Type it again'), { target: { value: PASSWORD } })
  if (email) fireEvent.change(screen.getByLabelText('Email (optional)'), { target: { value: email } })
}
const saveButton = () => screen.getByRole('button', { name: 'Save — then hand back to Kwame' })

describe('OwnerHandover — the owner-only screen', () => {
  it('covers the staff shell, shows the business and counts down the 30 minutes', async () => {
    const seen = startHandover()
    const { closeHandover } = renderHandover()
    expect(screen.getByRole('dialog', { name: 'Owner setup' })).toBeInTheDocument()
    // The shell's menus are hidden (aria-hidden + inert) while the owner holds the phone.
    expect(screen.queryByRole('navigation', { name: 'Quick navigation' })).not.toBeInTheDocument()
    expect(document.documentElement.style.overflow).toBe('hidden')
    expect(await screen.findByText('Asafo Hair & Beauty')).toBeInTheDocument()
    expect(screen.getByText(/Akwaaba, Gifty/)).toBeInTheDocument()
    expect(screen.getByText(/Kwame's menus stay hidden until you finish/)).toBeInTheDocument()
    expect(screen.getByText(/This setup closes in 30 min/)).toBeInTheDocument()
    expect(seen.starts).toBe(1)
    expect(seen.previewToken).toBe('handover-tok')
    closeHandover()
    expect(screen.getByRole('navigation', { name: 'Quick navigation' })).toBeInTheDocument()
    expect(document.documentElement.style.overflow).toBe('')
  })
})

describe('OwnerHandover — Back and autofill', () => {
  it('keeps the owner-only screen up when Back is pressed', async () => {
    startHandover()
    renderHandover()
    await screen.findByText('Asafo Hair & Beauty')
    const before = window.location.href
    window.dispatchEvent(new PopStateEvent('popstate'))
    expect(screen.getByRole('dialog', { name: 'Owner setup' })).toBeInTheDocument()
    expect(window.location.href).toBe(before)
  })

  it("stops the browser offering to save the owner's password on the scout's phone", async () => {
    startHandover()
    renderHandover()
    await screen.findByText('Asafo Hair & Beauty')
    expect(screen.getByLabelText('Set your password')).toHaveAttribute('autocomplete', 'off')
    expect(screen.getByLabelText('Type it again')).toHaveAttribute('autocomplete', 'off')
    // The scout's phone mustn't offer the scout's own saved email either.
    expect(screen.getByLabelText('Email (optional)')).toHaveAttribute('autocomplete', 'off')
    expect(screen.getByText("Password resets go to gi•••@example.com. If that isn't your email, enter yours below.")).toBeInTheDocument()
    expect(screen.getByText(/If the phone offers to save it, tap Never/)).toBeInTheDocument()
  })
})

describe('OwnerHandover — the password (Review Focus 3)', () => {
  it('posts the claim to /api/accounts/business-owners/claim/ and keeps no copy of the password after submit', async () => {
    startHandover()
    let claimBody = null
    server.use(http.post(CLAIM_URL, async ({ request }) => {
      claimBody = await request.json()
      return HttpResponse.json({ claimed: true, login_phone: '+233201234761', business_name: 'Asafo Hair & Beauty' })
    }))
    const { onDone } = renderHandover()
    await screen.findByText('Asafo Hair & Beauty')
    fillClaimForm({ email: 'gifty.a@example.com' })
    expect(screen.getByText('Passwords match')).toBeInTheDocument()
    fireEvent.click(saveButton())
    expect(await screen.findByText(/You're all set, Gifty/)).toBeInTheDocument()
    expect(claimBody).toEqual({
      token: 'handover-tok', password: PASSWORD, password_confirm: PASSWORD, email: 'gifty.a@example.com', accept_terms: true,
    })
    expect([...document.querySelectorAll('input')].some((input) => input.value === PASSWORD)).toBe(false)
    expect(document.body.textContent).not.toContain(PASSWORD)
    fireEvent.click(screen.getByRole('button', { name: 'Hand the phone back to Kwame' }))
    expect(onDone).toHaveBeenCalledWith({ claimed: true })
  })

  it('asks for the terms, 8 characters and a matching password before sending anything', async () => {
    startHandover()
    let posted = false
    server.use(http.post(CLAIM_URL, () => { posted = true; return HttpResponse.json({}) }))
    renderHandover()
    await screen.findByText('Asafo Hair & Beauty')
    fireEvent.change(screen.getByLabelText('Set your password'), { target: { value: 'short' } })
    fireEvent.change(screen.getByLabelText('Type it again'), { target: { value: 'short' } })
    fireEvent.click(saveButton())
    expect(screen.getByRole('alert')).toHaveTextContent('Accept the Business Agreement to continue.')
    fireEvent.click(screen.getByLabelText(/I have read and accept/))
    fireEvent.click(saveButton())
    expect(screen.getByRole('alert')).toHaveTextContent('Use at least 8 characters for your password.')
    fireEvent.change(screen.getByLabelText('Set your password'), { target: { value: PASSWORD } })
    fireEvent.click(saveButton())
    expect(screen.getByRole('alert')).toHaveTextContent("The two passwords don't match.")
    expect(screen.getByText("Passwords don't match yet")).toBeInTheDocument()
    expect(posted).toBe(false)
  })

  it("shows the server's refusal when the setup belongs to another phone", async () => {
    startHandover()
    server.use(http.post(CLAIM_URL, () => HttpResponse.json(
      { detail: 'Finish the hand-over on the phone that started it.', code: 'wrong_device' }, { status: 403 },
    )))
    renderHandover()
    await screen.findByText('Asafo Hair & Beauty')
    fillClaimForm()
    fireEvent.click(saveButton())
    expect(await screen.findByText('Finish the hand-over on the phone that started it.')).toBeInTheDocument()
    expect(screen.queryByText(/You're all set/)).not.toBeInTheDocument()
  })
})

describe('OwnerHandover — when it cannot go ahead', () => {
  it('closes the setup once the 30 minutes are up', async () => {
    startHandover({ expiresAt: new Date(Date.now() - 1000).toISOString() })
    const { onDone } = renderHandover()
    expect(await screen.findByText(/This setup has closed/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Set your password')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Hand the phone back to Kwame' }))
    expect(onDone).toHaveBeenCalledWith({ claimed: false })
  })

  it("says why when the hand-over can't start", async () => {
    startHandover({ start: () => HttpResponse.json({ detail: 'This owner already has a login.' }, { status: 400 }) })
    const { onDone } = renderHandover()
    expect(await screen.findByText('This owner already has a login.')).toBeInTheDocument()
    expect(screen.queryByLabelText('Set your password')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Hand the phone back to Kwame' }))
    expect(onDone).toHaveBeenCalledWith({ claimed: false })
  })

  it('Cancel hands the phone back without a login', async () => {
    startHandover()
    const { onDone } = renderHandover()
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel — hand back to Kwame' }))
    expect(onDone).toHaveBeenCalledWith({ claimed: false })
  })
})

describe('OwnerHandover — the scout\'s session and focus', () => {
  it("keeps sending the scout's token, which the hand-over is bound to", async () => {
    setStoredAuth({ token: 'staff-tok', account_type: 'staff' })
    const sent = { preview: null, claims: [] }
    server.use(
      http.post(HANDOVER_URL, () => HttpResponse.json({ token: 'handover-tok', expires_at: inMinutes(30) }, { status: 201 })),
      http.get(CLAIM_URL, ({ request }) => { sent.preview = request.headers.get('authorization'); return HttpResponse.json(preview()) }),
      http.post(CLAIM_URL, ({ request }) => {
        sent.claims.push(request.headers.get('authorization'))
        return HttpResponse.json({ detail: 'Finish the hand-over on the phone that started it.', code: 'wrong_device' }, { status: 403 })
      }),
    )
    renderHandover()
    await screen.findByText('Asafo Hair & Beauty')
    fillClaimForm()
    fireEvent.click(saveButton())
    expect(await screen.findByText('Finish the hand-over on the phone that started it.')).toBeInTheDocument()
    expect(sent.preview).toBe('Bearer staff-tok')
    expect(sent.claims).toEqual(['Bearer staff-tok'])
  })

  it('returns focus to the button that opened it once the phone is handed back', async () => {
    startHandover()
    function Page() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>Hand the phone to Gifty</button>
          {open && <OwnerHandover businessId={41} ownerFirstName="Gifty" scoutName="Kwame" onDone={() => setOpen(false)} />}
        </>
      )
    }
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={queryClient}><Page /></QueryClientProvider>)
    const opener = screen.getByRole('button', { name: 'Hand the phone to Gifty' })
    opener.focus()
    fireEvent.click(opener)
    expect(await screen.findByRole('dialog', { name: 'Owner setup' })).toBeInTheDocument()
    expect(document.activeElement).not.toBe(opener)
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel — hand back to Kwame' }))
    expect(screen.queryByRole('dialog', { name: 'Owner setup' })).not.toBeInTheDocument()
    expect(document.activeElement).toBe(opener)
  })
})
