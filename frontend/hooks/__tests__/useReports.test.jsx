import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../mocks/server.js'
import { exportsRefetchInterval, useReportExports } from '../useReports.js'

const q = (data) => ({ state: { data } })

describe('useReportExports polling', () => {
  it('polls every 10 s while a row is queued or running', () => {
    expect(exportsRefetchInterval(q([{ status: 'ready' }, { status: 'queued' }]))).toBe(10000)
    expect(exportsRefetchInterval(q([{ status: 'running' }]))).toBe(10000)
  })

  it('does not poll when nothing is pending', () => {
    expect(exportsRefetchInterval(q([{ status: 'ready' }, { status: 'failed' }]))).toBe(false)
    expect(exportsRefetchInterval(q([]))).toBe(false)
    expect(exportsRefetchInterval(q(undefined))).toBe(false)
  })

  it('loads the list through the hook', async () => {
    server.use(http.get('http://localhost:8000/api/reports/exports/', () => HttpResponse.json([{ id: 1, status: 'ready' }])))
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { result } = renderHook(() => useReportExports(), { wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> })
    await waitFor(() => expect(result.current.data).toHaveLength(1))
  })
})
