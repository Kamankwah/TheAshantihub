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
// presses Load more again). The same restart happens when a refetched later page
// differs from the one kept. Rows are also de-duplicated as a backstop, by
// `rowKey` (default: the row's id; rows with no key are always kept). A list
// ordered by something that moves (wallet balances) passes its own key.
export function usePagedRows(usePage, { rowKey = (r) => r?.id } = {}) {
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
      if (pages[page] && pages[page] !== data) {
        // A kept later page was refetched and differs: rows have shifted between pages.
        setPages(firstData ? { 1: firstData } : {})
        setPage(1)
      } else if (!pages[page]) {
        setPages((p) => ({ ...p, [page]: data }))
      }
    }
  }, [firstChanged, firstData, data, page, pages])

  const loaded = Object.keys(pages).sort((a, b) => a - b).map((k) => pages[k])
  const nextPage = loaded.length ? Math.max(...Object.keys(pages).map(Number)) + 1 : 1
  const seen = new Set()
  const rows = loaded.flatMap((p) => p.results || []).filter((r) => {
    const key = rowKey(r)
    if (key == null) return true
    if (seen.has(key)) return false
    seen.add(key)
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
