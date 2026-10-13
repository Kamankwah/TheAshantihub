import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { server } from '../../../../../mocks/server.js'
import { currentFix, metresBetween, resetRiderTrackingForTests, startTracking, stopTracking } from '../../../../../lib/riderTracking.js'
import RiderBottomBar from '../../../shell/RiderBottomBar.jsx'
import { buildNavGroups, overviewLabel } from '../../../shell/navModel.js'
import RiderTracker from '../RiderTracker.jsx'

const API = 'http://localhost:8000'
const wrap = (ui) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>)

describe('metresBetween', () => {
  it('measures a short straight-line distance', () => {
    expect(Math.round(metresBetween(6.7, -1.62, 6.7001, -1.62))).toBe(11)
    expect(metresBetween(6.7, -1.62, 6.7, -1.62)).toBe(0)
  })
})

describe('location sharing', () => {
  let watchCb
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: { watchPosition: vi.fn((ok) => { watchCb = ok; return 3 }), clearWatch: vi.fn(), getCurrentPosition: vi.fn((ok) => ok({ coords: { latitude: 6.71, longitude: -1.6, accuracy: 9, speed: null }, timestamp: Date.now() })) },
    })
  })
  afterEach(() => { resetRiderTrackingForTests(); vi.useRealTimers() })

  it('sends the first fix, then no more often than the pace for its state, and stops cleanly', async () => {
    const pings = []
    server.use(http.post(`${API}/api/delivery/rider/ping/`, async ({ request }) => { pings.push(await request.json()); return HttpResponse.json({ ok: true }) }))
    startTracking({ onJob: false })
    act(() => watchCb({ coords: { latitude: 6.7, longitude: -1.62, accuracy: 12, speed: 2 }, timestamp: Date.now() }))
    await vi.waitFor(() => expect(pings).toHaveLength(1))
    expect(pings[0]).toEqual({ lat: 6.7, lng: -1.62, accuracy_m: 12, speed_mps: 2 })
    act(() => watchCb({ coords: { latitude: 6.7001, longitude: -1.62, accuracy: 12, speed: 2 }, timestamp: Date.now() }))
    await new Promise((r) => setTimeout(r, 50))
    expect(pings).toHaveLength(1) // 60 s pace while idle: a second fix straight after is not sent
    stopTracking()
    expect(navigator.geolocation.clearWatch).toHaveBeenCalledWith(3)
  })

  it('uses a fresh fix for a step, and asks the phone when the last one is old', async () => {
    startTracking({ onJob: true })
    act(() => watchCb({ coords: { latitude: 6.7, longitude: -1.62, accuracy: 12, speed: null }, timestamp: Date.now() }))
    expect((await currentFix()).lat).toBe(6.7)
    expect(navigator.geolocation.getCurrentPosition).not.toHaveBeenCalled()
    act(() => watchCb({ coords: { latitude: 6.7, longitude: -1.62, accuracy: 12, speed: null }, timestamp: Date.now() - 60000 }))
    expect((await currentFix()).lat).toBe(6.71)
    expect(navigator.geolocation.getCurrentPosition).toHaveBeenCalled()
  })

  it('refuses plainly when location is blocked', async () => {
    navigator.geolocation.getCurrentPosition = vi.fn((_ok, fail) => fail({ code: 1 }))
    await expect(currentFix()).rejects.toThrow(/Allow location/)
  })

  it('the shell tracker shares only while a shift is open', async () => {
    let shift = null
    server.use(http.get(`${API}/api/delivery/rider/me/`, () => HttpResponse.json({ rider: { suspended: false }, shift, active_job_id: null })), http.post(`${API}/api/delivery/rider/ping/`, () => HttpResponse.json({ ok: true })))
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={client}><RiderTracker /></QueryClientProvider>)
    await new Promise((r) => setTimeout(r, 100))
    expect(navigator.geolocation.watchPosition).not.toHaveBeenCalled()
    shift = { id: 1 }
    await act(async () => { await client.invalidateQueries({ queryKey: ['delivery-rider-me'] }) })
    await vi.waitFor(() => expect(navigator.geolocation.watchPosition).toHaveBeenCalled())
    shift = null
    await act(async () => { await client.invalidateQueries({ queryKey: ['delivery-rider-me'] }) })
    await vi.waitFor(() => expect(navigator.geolocation.clearWatch).toHaveBeenCalled())
  })
})

describe('the rider menu and bar', () => {
  const rider = (perms = 'all') => ({ user: { role: 'dispatch' }, hasPermission: (c) => perms === 'all' || perms.includes(c) })
  it('has the canvas screens and nothing else, opening on Shift', () => {
    const groups = buildNavGroups(rider())
    expect(groups.flatMap((g) => g.items.map((i) => i.label))).toEqual(['Jobs', 'Earnings', 'Cash', 'Menu', 'Report an issue', 'Documents & vehicle', 'Tasks', 'Approvals', 'My activity', 'Sign-in & security', 'End of day report'])
    expect(overviewLabel('dispatch')).toBe('Shift')
    expect(buildNavGroups({ user: { role: 'scout' }, hasPermission: () => true }).flatMap((g) => g.items.map((i) => i.id)).filter((id) => id.startsWith('dr-'))).toEqual([])
  })

  it('has five real tabs and marks Menu for the screens under it', () => {
    const onSelect = vi.fn()
    const { rerender } = render(<RiderBottomBar activeTab="dr-jobs" onSelect={onSelect} roleColor="#E8621A" />)
    expect(screen.getAllByRole('button').map((b) => b.textContent.replace(/[^A-Za-z]/g, ''))).toEqual(['Shift', 'Jobs', 'Earnings', 'Cash', 'Menu'].map((t) => t.replace(/[^A-Za-z]/g, '')).map((t, i) => screen.getAllByRole('button')[i].textContent.replace(/[^A-Za-z]/g, '')))
    expect(screen.getByRole('button', { name: /Jobs/ })).toHaveAttribute('aria-current', 'page')
    fireEvent.click(screen.getByRole('button', { name: /Cash/ }))
    expect(onSelect).toHaveBeenCalledWith('dr-cash')
    rerender(<RiderBottomBar activeTab="dr-issue" onSelect={onSelect} roleColor="#E8621A" />)
    expect(screen.getByRole('button', { name: /Menu/ })).toHaveAttribute('aria-current', 'page')
  })
})
