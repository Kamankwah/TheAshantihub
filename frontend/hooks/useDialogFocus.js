import { useEffect } from 'react'

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

// Keyboard behaviour every modal dialog needs (review FE-07): focus moves into it on open, Tab/Shift+Tab
// stay inside, Esc closes it, and focus returns to what opened it on close. `ref` is the element carrying
// role="dialog"; the caller supplies the role, aria-modal and an accessible name.
export function useDialogFocus(ref, onClose) {
  useEffect(() => {
    const node = ref.current
    if (!node) return undefined
    const opener = document.activeElement
    const items = () => [...node.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement)
    if (!node.contains(document.activeElement)) {
      if (!node.hasAttribute('tabindex')) node.setAttribute('tabindex', '-1')
      ;(items()[0] || node).focus()
    }
    const onKeyDown = (event) => {
      if (event.key === 'Escape') { event.stopPropagation(); onClose?.(); return }
      if (event.key !== 'Tab') return
      const list = items()
      if (list.length === 0) { event.preventDefault(); return }
      const first = list[0]
      const last = list[list.length - 1]
      if (event.shiftKey && (document.activeElement === first || document.activeElement === node)) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    node.addEventListener('keydown', onKeyDown)
    return () => {
      node.removeEventListener('keydown', onKeyDown)
      if (opener && typeof opener.focus === 'function' && document.contains(opener)) opener.focus()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
