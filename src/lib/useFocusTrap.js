// Keeps Tab/Shift+Tab cycling within a modal dialog instead of escaping
// into the page behind it. Every `role="dialog"` in this app already
// gets aria-modal, an accessible name, an initial focus, and an Escape
// handler -- this closes the one piece those were missing: a keyboard
// user tabbing forward past the last control (or back past the first)
// used to land on the page content behind the dimmed overlay, which is
// still there in the DOM even though it's visually covered.
//
// Usage: const dialogRef = useRef(null); useFocusTrap(dialogRef); then
// pass ref={dialogRef} to the same element that has role="dialog".
import { useEffect } from 'react'

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function useFocusTrap(containerRef) {
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const onKeyDown = (e) => {
      if (e.key !== 'Tab') return
      const focusable = Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR)).filter(
        (el) => el.offsetParent !== null
      )
      if (focusable.length === 0) return

      const first = focusable[0]
      const last = focusable[focusable.length - 1]

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }

    container.addEventListener('keydown', onKeyDown)
    return () => container.removeEventListener('keydown', onKeyDown)
  }, [containerRef])
}
