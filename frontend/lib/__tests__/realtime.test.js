import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BACKOFF_MS, PAUSED_AFTER_MS, createRealtimeClient, realtimeUrl } from '../realtime.js'

class FakeSocket {
  constructor(url) { this.url = url; this.closed = false; FakeSocket.all.push(this) }
  open() { this.onopen?.() }
  push(data) { this.onmessage?.({ data: JSON.stringify(data) }) }
  drop() { this.onclose?.() }
  close() { this.closed = true }
}

const failing = (status) => vi.fn(async () => { throw Object.assign(new Error(String(status)), { status }) })

function setup(getTicket = vi.fn(async () => 'tkt')) {
  const invalidated = []
  const client = createRealtimeClient({
    apiBase: 'https://api.example.com',
    getTicket,
    createSocket: (url) => new FakeSocket(url),
    onInvalidate: (keys) => invalidated.push(...keys),
  })
  return { client, invalidated, getTicket }
}

beforeEach(() => { vi.useFakeTimers(); FakeSocket.all = [] })
afterEach(() => vi.useRealTimers())

describe('realtimeUrl', () => {
  it('turns the API origin into a ws(s) URL carrying the ticket', () => {
    expect(realtimeUrl('https://api.example.com', 'a b')).toBe('wss://api.example.com/ws/staff/?ticket=a%20b')
    expect(realtimeUrl('http://localhost:8000/', 't')).toBe('ws://localhost:8000/ws/staff/?ticket=t')
  })
})

describe('createRealtimeClient', () => {
  it('connects with a fresh ticket and goes live', async () => {
    const { client } = setup()
    client.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(FakeSocket.all[0].url).toBe('wss://api.example.com/ws/staff/?ticket=tkt')
    FakeSocket.all[0].open()
    expect(client.getStatus()).toEqual({ live: true, paused: false })
    client.stop()
  })

  it('hands invalidate keys to the query cache', async () => {
    const { client, invalidated } = setup()
    client.start()
    await vi.advanceTimersByTimeAsync(0)
    FakeSocket.all[0].open()
    FakeSocket.all[0].push({ type: 'invalidate', invalidate: ['kyc-queue', 'staff-badges'], at: 'now' })
    FakeSocket.all[0].push({ type: 'activity', verb: 'kyc-approve', target: {}, actor: {}, at: 'now', invalidate: ['activity'] })
    expect(invalidated).toEqual(['kyc-queue', 'staff-badges', 'activity'])
    client.stop()
  })

  it('reconnects with backoff after the socket drops', async () => {
    const { client, getTicket } = setup()
    client.start()
    await vi.advanceTimersByTimeAsync(0)
    FakeSocket.all[0].open()
    FakeSocket.all[0].drop()
    expect(client.getStatus().live).toBe(false)
    await vi.advanceTimersByTimeAsync(BACKOFF_MS[0] - 1)
    expect(FakeSocket.all).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(FakeSocket.all).toHaveLength(2)
    FakeSocket.all[1].drop()
    await vi.advanceTimersByTimeAsync(BACKOFF_MS[1])
    expect(FakeSocket.all).toHaveLength(3)
    expect(getTicket).toHaveBeenCalledTimes(3)
    client.stop()
  })

  it('says "paused" only after 30 seconds without a live socket, and clears it once live', async () => {
    let up = false
    const getTicket = vi.fn(async () => {
      if (!up) throw Object.assign(new Error('503'), { status: 503 })
      return 'tkt'
    })
    const { client } = setup(getTicket)
    client.start()
    await vi.advanceTimersByTimeAsync(PAUSED_AFTER_MS - 1)
    expect(client.getStatus().paused).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(client.getStatus().paused).toBe(true)
    up = true
    await vi.advanceTimersByTimeAsync(BACKOFF_MS.at(-1))
    FakeSocket.all.at(-1).open()
    expect(client.getStatus()).toEqual({ live: true, paused: false })
    client.stop()
  })

  it('stops for good when the session has ended', async () => {
    const getTicket = failing(401)
    const { client } = setup(getTicket)
    client.start()
    await vi.advanceTimersByTimeAsync(60000)
    expect(getTicket).toHaveBeenCalledTimes(1)
    expect(client.getStatus().paused).toBe(false)
  })

  it('reconnects promptly when the server asks it to', async () => {
    const { client } = setup()
    client.start()
    await vi.advanceTimersByTimeAsync(0)
    FakeSocket.all[0].open()
    FakeSocket.all[0].drop()
    await vi.advanceTimersByTimeAsync(BACKOFF_MS[0])
    FakeSocket.all[1].open()
    FakeSocket.all[1].push({ type: 'force_disconnect' })
    FakeSocket.all[1].drop()
    await vi.advanceTimersByTimeAsync(BACKOFF_MS[0])
    expect(FakeSocket.all).toHaveLength(3)
    client.stop()
  })

  it('stop() closes the socket and cancels every retry', async () => {
    const { client } = setup()
    client.start()
    await vi.advanceTimersByTimeAsync(0)
    FakeSocket.all[0].open()
    client.stop()
    expect(FakeSocket.all[0].closed).toBe(true)
    FakeSocket.all[0].drop()
    await vi.advanceTimersByTimeAsync(60000)
    expect(FakeSocket.all).toHaveLength(1)
  })
})

describe('createRealtimeClient — fix round 1', () => {
  it('backs off further on consecutive failures and resets after a successful open', async () => {
    const { client, getTicket } = setup()
    client.start()
    await vi.advanceTimersByTimeAsync(0)
    FakeSocket.all[0].drop()
    await vi.advanceTimersByTimeAsync(BACKOFF_MS[0])
    FakeSocket.all[1].drop()
    await vi.advanceTimersByTimeAsync(BACKOFF_MS[1] - 1)
    expect(FakeSocket.all).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(FakeSocket.all).toHaveLength(3)
    FakeSocket.all[2].open()
    FakeSocket.all[2].drop()
    await vi.advanceTimersByTimeAsync(BACKOFF_MS[0])
    expect(FakeSocket.all).toHaveLength(4)
    expect(getTicket).toHaveBeenCalledTimes(4)
    client.stop()
  })

  it('stops for good on a 403 from the ticket endpoint', async () => {
    const getTicket = failing(403)
    const { client } = setup(getTicket)
    client.start()
    await vi.advanceTimersByTimeAsync(60000)
    expect(getTicket).toHaveBeenCalledTimes(1)
    expect(client.getStatus().paused).toBe(false)
  })

  it('retries after a network error that carries no status', async () => {
    const getTicket = vi.fn(async () => { throw new TypeError('Failed to fetch') })
    const { client } = setup(getTicket)
    client.start()
    await vi.advanceTimersByTimeAsync(BACKOFF_MS[0] + BACKOFF_MS[1])
    expect(getTicket.mock.calls.length).toBeGreaterThanOrEqual(3)
    client.stop()
  })

  it('arms no pause timer when stopped while the ticket request is failing', async () => {
    let reject
    const getTicket = vi.fn(() => new Promise((_, r) => { reject = r }))
    const { client } = setup(getTicket)
    client.start()
    client.stop()
    reject(new Error('late'))
    await vi.advanceTimersByTimeAsync(PAUSED_AFTER_MS * 2)
    expect(client.getStatus().paused).toBe(false)
  })

  it('ignores messages from a socket that is no longer current', async () => {
    const { client, invalidated } = setup()
    client.start()
    await vi.advanceTimersByTimeAsync(0)
    const old = FakeSocket.all[0]
    old.open()
    old.drop()
    await vi.advanceTimersByTimeAsync(BACKOFF_MS[0])
    old.push({ type: 'invalidate', invalidate: ['kyc-queue'], at: 'now' })
    expect(invalidated).toEqual([])
    client.stop()
  })
})
