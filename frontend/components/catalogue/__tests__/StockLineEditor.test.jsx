import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../../mocks/server.js'
import StockLineEditor from '../StockLineEditor.jsx'

const API = 'http://localhost:8000'
const cover = { listing_id: 5, name: 'Rice', stock: 4, units_sold: 0, days_on_sale: 3, days_of_cover: null, basis: 'own_threshold', line: 6, low: true, sold_out: false }
const settings = { cover_days: 7, fallback_units: 5, window_days: 28 }

function setup(line = { listing_id: 5, line: 6, cover }) {
  const puts = []
  let invalidated = 0
  server.use(
    http.get(`${API}/api/catalogue/stock/5/line/`, () => HttpResponse.json(line)),
    http.put(`${API}/api/catalogue/stock/5/line/`, async ({ request }) => { puts.push(await request.json()); return HttpResponse.json(line) }),
  )
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const orig = qc.invalidateQueries.bind(qc)
  qc.invalidateQueries = (...a) => { invalidated += 1; return orig(...a) }
  render(<QueryClientProvider client={qc}><StockLineEditor listingId={5} settings={settings} /></QueryClientProvider>)
  return { puts, invalidated: () => invalidated }
}

describe('StockLineEditor', () => {
  it('test_line_editor_prefills_the_saved_line_not_the_default', async () => {
    setup()
    expect(await screen.findByText('Your alert line: 6 units')).toBeInTheDocument()
    expect(screen.getByRole('textbox')).toHaveValue('6')
    expect(screen.getByText('4 left. Your alert line is 6.')).toBeInTheDocument()
  })

  it('test_saving_puts_the_units_and_refreshes_the_stock_queries', async () => {
    const { puts, invalidated } = setup()
    const box = await screen.findByRole('textbox')
    fireEvent.change(box, { target: { value: '' } })
    fireEvent.change(box, { target: { value: ' 9 ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Saved. It shows in Needs restocking at 9 or fewer.')).toBeInTheDocument()
    expect(puts).toEqual([{ units: '9' }])
    expect(invalidated()).toBeGreaterThan(0)
  })

  it('test_zero_is_a_real_line', async () => {
    const { puts } = setup()
    const box = await screen.findByRole('textbox')
    fireEvent.change(box, { target: { value: '' } })
    fireEvent.change(box, { target: { value: '0' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await screen.findByText('Saved. It shows in Needs restocking at 0 or fewer.')
    expect(puts).toEqual([{ units: '0' }])
  })

  it('test_use_the_default_puts_null', async () => {
    const { puts } = setup()
    fireEvent.click(await screen.findByRole('button', { name: 'Use the default' }))
    expect(await screen.findByText("Saved. Using AshantiHub's default.")).toBeInTheDocument()
    expect(puts).toEqual([{ units: null }])
  })

  it('test_bad_units_show_the_servers_units_message', async () => {
    setup()
    server.use(http.put(`${API}/api/catalogue/stock/5/line/`, () => HttpResponse.json({ units: 'Enter a whole number of units from 0 to 100,000.' }, { status: 400 })))
    const box = await screen.findByRole('textbox')
    fireEvent.change(box, { target: { value: '' } })
    fireEvent.change(box, { target: { value: 'abc' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Enter a whole number of units from 0 to 100,000.')).toBeInTheDocument()
  })

  it('test_uncounted_listing_says_count_stock_first_and_offers_no_input', async () => {
    setup({ listing_id: 5, line: null, cover: null })
    expect(await screen.findByText("Count this product's stock first to set an alert line.")).toBeInTheDocument()
    expect(screen.getByText("Using AshantiHub's default")).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('test_double_click_puts_once', async () => {
    const { puts } = setup()
    const save = await screen.findByRole('button', { name: 'Save' })
    fireEvent.click(save)
    fireEvent.click(save)
    await waitFor(() => expect(puts.length).toBe(1))
    await screen.findByText(/^Saved\./)
    expect(puts.length).toBe(1)
  })
})
