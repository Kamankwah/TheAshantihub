import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setStepUpHandler } from '../../../apiClient.js'
import { server } from '../../../mocks/server.js'
import AddDestinationForm from '../AddDestinationForm.jsx'
import DestinationsList from '../DestinationsList.jsx'

const API = 'http://localhost:8000'
const wrap = (ui) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}
const row = (over = {}) => ({
  id: 7, rail: 'momo', institution: 'MTN', account_name: 'Akosua Ntoma', account_number_masked: '024****567',
  name_check: 'hubtel', usable_from: '2026-10-01T10:00:00Z', usable: true, removed: false, ...over,
})
const list = (rows, path = '/api/wallet', cooling_hours = 24) =>
  server.use(http.get(`${API}${path}/destinations/`, () => HttpResponse.json({ results: rows, cooling_hours })))
const stepUpNeeded = () => HttpResponse.json({ detail: 'Enter a code.', code: 'step_up_required', action: 'payout_destination' }, { status: 403 })
let unregister = null
const installHandler = (handler) => { unregister = setStepUpHandler(handler) }
const fill = (num) => fireEvent.change(screen.getByLabelText(/mobile money number/i), { target: { value: num } })

afterEach(() => {
  if (unregister) unregister()
  unregister = null
  vi.restoreAllMocks()
})

describe('DestinationsList', () => {
  it('test_lists_masked_numbers_only_and_never_a_full_number', async () => {
    list([row()])
    wrap(<DestinationsList />)
    expect(await screen.findByText('024****567')).toBeInTheDocument()
    expect(screen.getByText('Akosua Ntoma')).toBeInTheDocument()
    expect(screen.getByText('Name checked')).toBeInTheDocument()
    expect(screen.queryByText(/0241234567/)).toBeNull()
    expect(screen.queryByRole('button', { name: /edit/i })).toBeNull()
  })

  it('test_cooling_destination_shows_can_receive_from_and_the_cooling_hours_line', async () => {
    list([row({ usable: false, usable_from: '2026-10-22T14:05:00Z' })], '/api/wallet', 24)
    wrap(<DestinationsList />)
    expect(await screen.findByText('Can receive money from 22 Oct 2026, 14:05')).toBeInTheDocument()
    expect(screen.getByText('A new number can receive money after 24 hours.')).toBeInTheDocument()
  })

  it('test_remove_confirms_then_posts', async () => {
    list([row()])
    const calls = []
    server.use(http.post(`${API}/api/wallet/destinations/7/remove/`, async ({ request }) => {
      calls.push(await request.json())
      return new HttpResponse(null, { status: 204 })
    }))
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const onChanged = vi.fn()
    wrap(<DestinationsList onChanged={onChanged} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    expect(window.confirm).toHaveBeenCalled()
    expect(calls).toEqual([{}])
  })

  it('test_remove_cancelled_confirm_sends_nothing', async () => {
    list([row()])
    const calls = []
    server.use(http.post(`${API}/api/wallet/destinations/7/remove/`, () => { calls.push(1); return new HttpResponse(null, { status: 204 }) }))
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    wrap(<DestinationsList />)
    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }))
    await new Promise((r) => setTimeout(r, 30))
    expect(calls).toHaveLength(0)
  })

  it('test_base_path_is_honoured', async () => {
    list([row({ account_number_masked: '055****999' })], '/api/business/wallet')
    const removed = []
    server.use(http.post(`${API}/api/business/wallet/destinations/7/remove/`, () => { removed.push(1); return new HttpResponse(null, { status: 204 }) }))
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    wrap(<DestinationsList basePath="/api/business/wallet" />)
    expect(await screen.findByText('055****999')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(removed).toHaveLength(1))
  })

  it('test_ledger_off_state', async () => {
    server.use(http.get(`${API}/api/wallet/destinations/`, () => HttpResponse.json({ detail: 'Off.', code: 'ledger_off' }, { status: 409 })))
    wrap(<DestinationsList />)
    expect(await screen.findByText("Wallets aren't switched on yet.")).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull()
  })
})

describe('AddDestinationForm', () => {
  it('test_add_goes_through_the_step_up_retry_and_posts_the_same_body_twice', async () => {
    const seen = []
    server.use(http.post(`${API}/api/wallet/destinations/`, async ({ request }) => {
      const token = request.headers.get('x-step-up-token')
      seen.push({ token, body: await request.json() })
      return token
        ? HttpResponse.json(row({ usable: false, usable_from: '2026-10-22T14:05:00Z' }), { status: 201 })
        : stepUpNeeded()
    }))
    const handler = vi.fn().mockResolvedValue({ token: 'tok1', expiresIn: 300 })
    installHandler(handler)
    wrap(<AddDestinationForm />)
    fill('0241234567')
    fireEvent.click(screen.getByRole('button', { name: 'Add destination' }))
    expect(await screen.findByText('Added. It can receive money from 22 Oct 2026, 14:05')).toBeInTheDocument()
    expect(handler).toHaveBeenCalledWith('payout_destination')
    expect(seen).toHaveLength(2)
    expect(seen[0].token).toBeNull()
    expect(seen[1].token).toBe('tok1')
    expect(seen[1].body).toEqual(seen[0].body)
    expect(seen[0].body).toEqual({ rail: 'momo', institution: 'MTN', account_number: '0241234567' })
  })

  it('test_add_cancelled_prompt_shows_the_try_again_text', async () => {
    server.use(http.post(`${API}/api/wallet/destinations/`, () => stepUpNeeded()))
    installHandler(vi.fn().mockResolvedValue(null))
    wrap(<AddDestinationForm />)
    fill('0241234567')
    fireEvent.click(screen.getByRole('button', { name: 'Add destination' }))
    expect(await screen.findByText('We need to confirm it is you. Try again and enter the code.')).toBeInTheDocument()
  })

  it('test_add_refusal_text_is_shown_verbatim', async () => {
    server.use(http.post(`${API}/api/wallet/destinations/`, () =>
      HttpResponse.json({ detail: 'The name on that account does not match yours.', code: 'name_mismatch' }, { status: 400 })))
    wrap(<AddDestinationForm />)
    fill('0241234567')
    fireEvent.click(screen.getByRole('button', { name: 'Add destination' }))
    expect(await screen.findByText('The name on that account does not match yours.')).toBeInTheDocument()
  })

  it('test_from_profile_posts_only_the_flag', async () => {
    const bodies = []
    server.use(http.post(`${API}/api/business/wallet/destinations/`, async ({ request }) => {
      bodies.push(await request.json())
      return HttpResponse.json(row(), { status: 201 })
    }))
    wrap(<AddDestinationForm basePath="/api/business/wallet" canCopyFromProfile />)
    fireEvent.click(screen.getByRole('button', { name: 'Use my registered payout details' }))
    await waitFor(() => expect(bodies).toHaveLength(1))
    expect(bodies[0]).toEqual({ from_profile: true })
  })

  it('test_from_profile_control_is_absent_unless_allowed', () => {
    wrap(<AddDestinationForm />)
    expect(screen.queryByRole('button', { name: /registered payout details/i })).toBeNull()
  })

  it('test_number_field_is_cleared_after_success', async () => {
    server.use(http.post(`${API}/api/wallet/destinations/`, () => HttpResponse.json(row(), { status: 201 })))
    const onDone = vi.fn()
    wrap(<AddDestinationForm onDone={onDone} />)
    fill('0241234567')
    fireEvent.click(screen.getByRole('button', { name: 'Add destination' }))
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(screen.getByLabelText(/mobile money number/i)).toHaveValue('')
  })

  it('test_no_card_fields_exist', () => {
    wrap(<AddDestinationForm />)
    expect(screen.queryByLabelText(/card|cvv|expiry/i)).toBeNull()
    expect(screen.getByLabelText(/mobile money number/i)).toHaveAttribute('autocomplete', 'off')
  })
})
