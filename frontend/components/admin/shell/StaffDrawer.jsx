import { useEffect, useRef } from "react";
import usePrefersReducedMotion from "../../../hooks/usePrefersReducedMotion.js";
import { D } from "../theme.js";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Slide-over navigation for phone/tablet: a modal dialog that locks page
// scroll, traps Tab, closes on Escape or backdrop tap, and hands focus back to
// whatever opened it (☰ or the bottom bar's More).
export default function StaffDrawer({ open, onClose, children }) {
  const panelRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const reducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    if (!open) return undefined;
    const opener = document.activeElement;
    const html = document.documentElement;
    const previousOverflow = html.style.overflow;
    html.style.overflow = "hidden";
    const focusables = () => Array.from(panelRef.current?.querySelectorAll(FOCUSABLE) ?? []);
    focusables()[0]?.focus();
    const onKeyDown = (event) => {
      if (event.key === "Escape") { event.preventDefault(); onCloseRef.current(); return; }
      if (event.key !== "Tab") return;
      const list = focusables();
      if (list.length === 0) return;
      const first = list[0];
      const last = list[list.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      html.style.overflow = previousOverflow;
      if (opener && typeof opener.focus === "function") opener.focus();
    };
  }, [open]);

  if (!open) return null;
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 200 }}>
      <div data-testid="staff-drawer-backdrop" onClick={() => onCloseRef.current()} style={{ position: "absolute", inset: 0, background: "rgba(44,24,16,0.45)" }} />
      <div ref={panelRef} role="dialog" aria-modal="true" aria-label="Staff navigation" style={{
        position: "absolute", top: 0, bottom: 0, left: 0, width: "min(320px, 86vw)",
        background: D.pageBg, boxShadow: D.shadow, overflowY: "auto", overscrollBehavior: "contain",
        paddingTop: "env(safe-area-inset-top, 0px)", paddingBottom: "env(safe-area-inset-bottom, 0px)", paddingLeft: "env(safe-area-inset-left, 0px)",
        animation: reducedMotion ? "none" : "staffDrawerIn 220ms ease-out",
      }}>
        {children}
      </div>
    </div>
  );
}
