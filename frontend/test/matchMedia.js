// Controllable window.matchMedia for viewport-dependent tests. Evaluates
// `(max-width: Npx)` / `(min-width: Npx)` clauses against a fake width and
// fires registered "change" listeners on resize(). The global stub in
// test/setup.js (matches: false for everything) stays the default.
export function installMatchMedia(initialWidth) {
  const original = window.matchMedia
  let width = initialWidth
  const listeners = new Set()
  const evaluate = (query) => {
    const max = /max-width:\s*(\d+)px/.exec(query)
    const min = /min-width:\s*(\d+)px/.exec(query)
    return (!max || width <= Number(max[1])) && (!min || width >= Number(min[1]))
  }
  window.matchMedia = (query) => ({
    media: query,
    get matches() { return evaluate(query) },
    addEventListener: (_type, cb) => listeners.add(cb),
    removeEventListener: (_type, cb) => listeners.delete(cb),
    addListener: (cb) => listeners.add(cb),
    removeListener: (cb) => listeners.delete(cb),
  })
  return {
    resize(nextWidth) {
      width = nextWidth
      listeners.forEach((cb) => cb({ matches: undefined }))
    },
    restore() {
      window.matchMedia = original
    },
  }
}
