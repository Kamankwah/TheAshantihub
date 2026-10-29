import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { server } from '../../../mocks/server.js'
import VariantEditor from './VariantEditor.jsx'

const API = 'http://localhost:8000'
const VARIANT = { id: 5, label: 'Size: Large', attributes: { Size: 'Large' }, price_amount: '10.00', stock_quantity: 4, position: 0, is_active: true }

function renderEditor(props) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><VariantEditor {...props} /></QueryClientProvider>)
}
const published = { id: 9, status: 'published', variants: [VARIANT] }

describe('VariantEditor', () => {
  it('adds a row and posts the variant', async () => {
    let body = null
    server.use(http.post(`${API}/api/listings/mine/9/variants/`, async ({ request }) => {
      body = await request.json()
      return HttpResponse.json({ id: 6, ...body }, { status: 201 })
    }))
    const onChanged = vi.fn()
    renderEditor({ listing: { id: 9, status: 'draft', variants: [] }, onChanged })
    fireEvent.change(screen.getByLabelText('Attribute name'), { target: { value: 'Flavour' } })
    fireEvent.change(screen.getByLabelText('Attribute value'), { target: { value: 'Mango' } })
    fireEvent.change(screen.getByLabelText('New variant price'), { target: { value: '12.5' } })
    fireEvent.change(screen.getByLabelText('New variant stock'), { target: { value: '7' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add variant' }))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    expect(body).toEqual({ attributes: { Flavour: 'Mango' }, price_amount: '12.5', stock_quantity: 7 })
  })

  it("a published listing's price and stock cells patch live", async () => {
    let body = null
    let revisionPuts = 0
    server.use(
      http.patch(`${API}/api/listings/mine/9/variants/5/live/`, async ({ request }) => { body = await request.json(); return HttpResponse.json({}) }),
      http.put(`${API}/api/listings/mine/9/revision/`, () => { revisionPuts += 1; return HttpResponse.json({}) }),
    )
    const onChanged = vi.fn()
    renderEditor({ listing: published, onChanged })
    expect(screen.getAllByText('Live now').length).toBeGreaterThan(0)
    fireEvent.change(screen.getByLabelText('Price for Size: Large'), { target: { value: '11.00' } })
    fireEvent.change(screen.getByLabelText('Stock for Size: Large'), { target: { value: '9' } })
    fireEvent.click(screen.getByRole('button', { name: /Save price & stock/ }))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    expect(body).toEqual({ price_amount: '11.00', stock_quantity: 9 })
    expect(revisionPuts).toBe(0)
  })

  it('attribute changes on a published listing go to the revision, not live', async () => {
    let revisionBody = null
    let livePatches = 0
    server.use(
      http.patch(`${API}/api/listings/mine/9/variants/5/live/`, () => { livePatches += 1; return HttpResponse.json({}) }),
      http.put(`${API}/api/listings/mine/9/revision/`, async ({ request }) => { revisionBody = await request.json(); return HttpResponse.json({}) }),
    )
    renderEditor({ listing: published, onChanged: vi.fn() })
    fireEvent.change(screen.getAllByLabelText('Attribute value')[0], { target: { value: 'Extra large' } })
    expect(screen.getAllByText('Needs approval').length).toBeGreaterThan(0)
    const save = await screen.findByRole('button', { name: 'Save attribute change' })
    await waitFor(() => expect(save).toBeEnabled()) // disabled while the open edit loads
    fireEvent.click(save)
    await waitFor(() => expect(revisionBody).not.toBeNull())
    expect(revisionBody).toEqual({ variants: [{ op: 'update', id: 5, attributes: { Size: 'Extra large' } }] })
    expect(livePatches).toBe(0)
  })

  it('shows the server words when a variant is refused', async () => {
    server.use(http.post(`${API}/api/listings/mine/9/variants/`, () => HttpResponse.json({ detail: 'Only products and food can have variants.' }, { status: 400 })))
    renderEditor({ listing: { id: 9, status: 'draft', variants: [] }, onChanged: vi.fn() })
    fireEvent.change(screen.getByLabelText('Attribute name'), { target: { value: 'Size' } })
    fireEvent.change(screen.getByLabelText('Attribute value'), { target: { value: 'S' } })
    fireEvent.change(screen.getByLabelText('New variant price'), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add variant' }))
    expect(await screen.findByText('Only products and food can have variants.')).toBeInTheDocument()
  })

  it('builds every URL from basePath', async () => {
    let hit = false
    server.use(http.patch(`${API}/api/direct/listings/9/variants/5/live/`, () => { hit = true; return HttpResponse.json({}) }))
    renderEditor({ listing: published, onChanged: vi.fn(), basePath: '/api/direct/listings' })
    fireEvent.change(screen.getByLabelText('Price for Size: Large'), { target: { value: '11.00' } })
    fireEvent.click(screen.getByRole('button', { name: /Save price & stock/ }))
    await waitFor(() => expect(hit).toBe(true))
  })

  it('changes only the price of a variant whose stock is not tracked', async () => {
    let body = null
    server.use(http.patch(`${API}/api/listings/mine/9/variants/5/live/`, async ({ request }) => { body = await request.json(); return HttpResponse.json({}) }))
    const onChanged = vi.fn()
    renderEditor({ listing: { id: 9, status: 'published', variants: [{ ...VARIANT, stock_quantity: null }] }, onChanged })
    expect(screen.getByLabelText('Stock for Size: Large')).toBeDisabled()
    expect(screen.getByText(/tracking cannot be switched on or off here/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Price for Size: Large'), { target: { value: '15.00' } })
    fireEvent.click(screen.getByRole('button', { name: /Save price & stock/ }))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    expect(body).toEqual({ price_amount: '15.00' })
  })
})
