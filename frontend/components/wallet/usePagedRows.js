import { useEffect, useState } from 'react'
import { walletMessage } from './walletErrors.js'

// Load-more paging over a DRF-paginated wallet hook (`usePage(page)` returns a
// query whose data is {results, next}). Pages are kept as they load. A failed
// page is retried, never skipped: loadMore always asks for the page after the
// highest loaded one, and the error stays inline until that page arrives.
export function usePagedRows(usePage) {
  const [page, setPage] = useState(1)
  const [pages, setPages] = useState({})
  const query = usePage(page)
  const data = query.data

  useEffect(() => {
    if (data) setPages((p) => ({ ...p, [page]: data }))
  }, [data, page])

  const loaded = Object.keys(pages).sort((a, b) => a - b).map((k) => pages[k])
  const nextPage = loaded.length ? Math.max(...Object.keys(pages).map(Number)) + 1 : 1
  return {
    query,
    loaded,
    rows: loaded.flatMap((p) => p.results || []),
    hasMore: loaded.length > 0 && Boolean(loaded[loaded.length - 1].next),
    loadMore: () => (page === nextPage ? query.refetch() : setPage(nextPage)),
    loadError: query.error ? walletMessage(query.error) : null,
  }
}
