import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { server } from '../../../../mocks/server.js'
import CategoryPictures from '../CategoryPictures.jsx'
import PictureSlot from '../PictureSlot.jsx'

const API = 'http://localhost:8000/api/listings'
const CATEGORIES = [
  { id: 10, slug: 'electronics', label: 'Electronics', icon: '📱', color: '#000080', kind: 'product', parent: null, image: 'https://cdn.test/e.jpg' },
  { id: 11, slug: 'electronics-headphones', label: 'Headphones', icon: '🎧', color: '#000080', kind: 'product', parent: 10, image: null },
  { id: 20, slug: 'books', label: 'Books', icon: '📚', color: '#006400', kind: 'product', parent: null, image: null },
  { id: 30, slug: 'hotels', label: 'Hotels', icon: '🏨', color: '#000080', kind: 'service', parent: null, image: null },
]
const png = () => new File([new Uint8Array([137, 80, 78, 71])], 'tile.png', { type: 'image/png' })

function renderWithClient(ui) {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>)
}

describe('CategoryPictures', () => {
  it('lists a department and its sub-categories, counts the pictured departments, and skips services', async () => {
    server.use(http.get(`${API}/categories/`, () => HttpResponse.json(CATEGORIES)))
    renderWithClient(<CategoryPictures canEdit />)
    expect(await screen.findByRole('heading', { name: 'Department pictures' })).toBeInTheDocument()
    expect(screen.getByText(/1 of 2 departments have a picture/)).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Picture for Electronics' })).toHaveAttribute('src', 'https://cdn.test/e.jpg')
    expect(screen.getByRole('button', { name: 'Upload picture for Headphones' })).toBeInTheDocument()
    const options = within(screen.getByLabelText('Department')).getAllByRole('option').map((o) => o.textContent)
    expect(options).toEqual(['Electronics', 'Books'])
    fireEvent.change(screen.getByLabelText('Department'), { target: { value: '20' } })
    expect(screen.queryByRole('button', { name: /Headphones/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'Upload picture for Books' })).toBeInTheDocument()
  })

  it('shows no upload buttons to someone who cannot manage categories', async () => {
    server.use(http.get(`${API}/categories/`, () => HttpResponse.json(CATEGORIES)))
    renderWithClient(<CategoryPictures canEdit={false} />)
    await screen.findByRole('heading', { name: 'Department pictures' })
    expect(screen.queryByRole('button', { name: /Upload|Replace|Remove/ })).toBeNull()
  })
})

describe('PictureSlot', () => {
  it('uploads the chosen file to the row\'s image endpoint and reports the change', async () => {
    // Never read a multipart body that holds a jsdom File (frontend/CLAUDE.md): spy on FormData.append instead.
    const append = vi.spyOn(FormData.prototype, 'append')
    server.use(http.post(`${API}/zones/3/image/`, () => HttpResponse.json({ id: 3, name: 'Manhyia', image: 'https://cdn.test/z.jpg' })))
    let changed = 0
    renderWithClient(<PictureSlot label="Manhyia" path="/api/listings/zones/3/image/" image={null} fallback="📍" onChanged={() => { changed += 1 }} />)
    fireEvent.change(screen.getByLabelText('Choose a picture for Manhyia'), { target: { files: [png()] } })
    await waitFor(() => expect(changed).toBe(1))
    expect(append).toHaveBeenCalledWith('image', expect.objectContaining({ name: 'tile.png' }))
    append.mockRestore()
  })

  it('shows the server\'s own message when the upload is refused, and Remove clears a picture', async () => {
    server.use(
      http.post(`${API}/categories/10/image/`, () => HttpResponse.json({ image: ['Each image must be 5 MB or smaller.'] }, { status: 400 })),
      http.delete(`${API}/categories/10/image/`, () => HttpResponse.json({ id: 10, image: null })),
    )
    let changed = 0
    renderWithClient(<PictureSlot label="Electronics" path="/api/listings/categories/10/image/" image="https://cdn.test/e.jpg" fallback="📱" onChanged={() => { changed += 1 }} />)
    fireEvent.change(screen.getByLabelText('Choose a picture for Electronics'), { target: { files: [png()] } })
    expect(await screen.findByRole('alert')).toHaveTextContent('Each image must be 5 MB or smaller.')
    expect(changed).toBe(0)
    fireEvent.click(screen.getByRole('button', { name: 'Remove picture for Electronics' }))
    await waitFor(() => expect(changed).toBe(1))
  })
})
