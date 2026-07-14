import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../mocks/server.js'
import { useSiteSettings } from '../useSiteSettings.js'

function renderWithClient(hook) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })
  return renderHook(hook, {
    wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  })
}

describe('useSiteSettings', () => {
  it('returns the site settings object on success', async () => {
    server.use(
      http.get('http://localhost:8000/api/core/site-settings/', () => {
        return HttpResponse.json({
          contact_email: 'hello@ashantihub.com',
          contact_phone: '+233201112233',
          contact_address: 'Adum, Kumasi',
          facebook_url: 'https://facebook.com/ashantihub',
          instagram_url: '',
          linkedin_url: '',
          twitter_url: '',
        })
      }),
    )
    const { result } = renderWithClient(() => useSiteSettings())
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.data.contact_email).toBe('hello@ashantihub.com')
    expect(result.current.data.facebook_url).toBe('https://facebook.com/ashantihub')
  })

  it('exposes isError on failure', async () => {
    server.use(
      http.get('http://localhost:8000/api/core/site-settings/', () => {
        return new HttpResponse(null, { status: 500 })
      }),
    )
    const { result } = renderWithClient(() => useSiteSettings())
    await waitFor(() => expect(result.current.isError).toBe(true))
  })
})
