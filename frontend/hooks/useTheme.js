import { useCallback, useEffect, useState } from 'react'

const THEME_STORAGE_KEY = 'ashantihub.theme'
const DARK_QUERY = '(prefers-color-scheme: dark)'

function readStored() {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY)
    return stored === 'light' || stored === 'dark' ? stored : null
  } catch {
    return null
  }
}

function deviceQuery() {
  try {
    return typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(DARK_QUERY) : null
  } catch {
    return null
  }
}

// Light/dark theme for the public site.
// - Nothing stored (a first visit): follow the device's colour-scheme setting,
//   and keep following it while the page is open, until the user toggles.
// - Only an explicit toggle is stored; from then on the stored choice wins.
// - The theme is applied to <html> as `data-theme` (read by the --ah-* CSS
//   variables in index.css that the inline-styled header/home consume) and as
//   the `dark` class (Tailwind's dark variant and the shadcn `.dark` tokens).
// Dashboards keep their own always-light token scope (.command-center).
export function useTheme() {
  const [stored, setStored] = useState(readStored)
  const [device, setDevice] = useState(() => (deviceQuery()?.matches ? 'dark' : 'light'))

  useEffect(() => {
    if (stored) return undefined
    const mql = deviceQuery()
    if (!mql) return undefined
    const onChange = (e) => setDevice(e.matches ? 'dark' : 'light')
    setDevice(mql.matches ? 'dark' : 'light')
    if (mql.addEventListener) mql.addEventListener('change', onChange)
    else if (mql.addListener) mql.addListener(onChange)
    return () => {
      if (mql.removeEventListener) mql.removeEventListener('change', onChange)
      else if (mql.removeListener) mql.removeListener(onChange)
    }
  }, [stored])

  const theme = stored ?? device

  useEffect(() => {
    const html = document.documentElement
    html.dataset.theme = theme
    html.classList.toggle('dark', theme === 'dark')
  }, [theme])

  const toggleTheme = useCallback(() => {
    const next = theme === 'dark' ? 'light' : 'dark'
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next)
    } catch {
      // Storage blocked (private mode): the toggle still works for this visit.
    }
    setStored(next)
  }, [theme])

  return { theme, toggleTheme }
}
