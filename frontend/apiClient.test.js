import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from './mocks/server.js'
import { apiFetch } from './apiClient.js'

describe('apiFetch', () => {
  it('returns parsed JSON on success', async () => {
    server.use(
      http.get('http://localhost:8000/api/listings/categories/', () => {
        return HttpResponse.json([{ id: 1, slug: 'hotels', icon: '🏨', label: 'Hotels', color: '#000080' }])
      }),
    )
    const data = await apiFetch('/api/listings/categories/')
    expect(data).toEqual([{ id: 1, slug: 'hotels', icon: '🏨', label: 'Hotels', color: '#000080' }])
  })

  it('throws on a non-2xx response', async () => {
    server.use(
      http.get('http://localhost:8000/api/listings/999/', () => {
        return new HttpResponse(null, { status: 404 })
      }),
    )
    await expect(apiFetch('/api/listings/999/')).rejects.toThrow()
  })
})
