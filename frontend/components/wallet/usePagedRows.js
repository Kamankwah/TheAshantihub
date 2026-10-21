import { useEffect, useState } from 'react'
import { walletMessage } from './walletErrors.js'

// Load-more paging over a DRF-paginated wallet hook (`usePage(page)` returns a
// query whose data is {results, next}). Pages are kept as they load. A failed
// page is retried, never skipped: loadMore always asks for the page after the
// highest loaded one, and the error stays inline until that page arrives.
//
// Page 1 is always observed too, so an invalidation or a window-focus refetch
// reaches it. When page 1 changes, the server's later pages have shifted, so the
// kept pages are dropped and the list starts again from page 1 (the reader
// presses Load more again). Rows are also de-duplicated by id as a backstop.
export function usePagedRows(usePage) {
  const [page, setPage] = useState(1)
  const [pages, setPages] = useState({})
  const first = usePage(1)
  const query = usePage(page)
  const data = query.data
  const firstData = first.data
  const firstChanged = Boolean(firstData) && pages[1] !== firstData

  useEffect(() => {
    if (firstChanged) {
      setPages({ 1: firstData })
      setPage(1)
    } else if (data && page > 1) {
      setPages((p) => ({ ...p, [page]: data }))
    }
  }, [firstChanged, firstData, data, page])

  const loaded = Object.keys(pages).sort((a, b) => a - b).map((k) => pages[k])
  const nextPage = loaded.length ? Math.max(...Object.keys(pages).map(Number)) + 1 : 1
  const seen = new Set()
  const rows = loaded.flatMap((p) => p.results || []).filter((r) => {
    if (r?.id == null) return true
    if (seen.has(r.id)) return false
    seen.add(r.id)
    return true
  })
  return {
    query,
    loaded,
    rows,
    hasMore: loaded.length > 0 && Boolean(loaded[loaded.length - 1].next),
    loadMore: () => (page === nextPage ? query.refetch() : setPage(nextPage)),
    loadError: query.error ? walletMessage(query.error) : null,
  }
}
