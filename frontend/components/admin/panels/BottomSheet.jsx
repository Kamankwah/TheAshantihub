import { useEffect, useRef } from "react";
import { D } from "../theme.js";

// A phone bottom sheet: role="dialog", Esc and the backdrop close it, Tab
// stays inside, focus goes in on open and back to the opener on close, and the
// page behind doesn't scroll. Used by Log a call and Add a prospect.
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function BottomSheet({ title, titleId, onClose, children }) {
  const sheet = useRef(null);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);

  useEffect(() => {
    const opener = document.activeElement;
    const root = document.documentElement;
    const overflow = root.style.overflow;
    root.style.overflow = "hidden";
    const first = sheet.current?.querySelector(FOCUSABLE);
    (first || sheet.current)?.focus();
    return () => {
      root.style.overflow = overflow;
      if (opener && opener !== document.body && opener.isConnected && typeof opener.focus === "function") opener.focus();
    };
  }, []);

  const onKeyDown = (event) => {
    if (event.key === "Escape") { event.stopPropagation(); closeRef.current?.(); return; }
    if (event.key !== "Tab") return;
    const items = Array.from(sheet.current?.querySelectorAll(FOCUSABLE) || []);
    if (items.length === 0) { event.preventDefault(); return; }
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === sheet.current)) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };

  return (
    <>
      <div onClick={onClose} aria-hidden="true" style={{ position: "fixed", inset: 0, zIndex: 1100, background: "rgba(44,24,16,0.45)" }} />
      <section ref={sheet} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} onKeyDown={onKeyDown}
        style={{
          position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 1101, margin: "0 auto", maxWidth: 560, maxHeight: "92vh", overflowY: "auto",
          overscrollBehavior: "contain", background: D.panelBg, borderRadius: "20px 20px 0 0", border: `1px solid ${D.cardBorder}`,
          padding: "10px 16px calc(20px + env(safe-area-inset-bottom, 0px))", display: "flex", flexDirection: "column", gap: 14, boxSizing: "border-box",
        }}>
        <span aria-hidden="true" style={{ alignSelf: "center", width: 40, height: 4, borderRadius: 4, background: D.divider }} />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <h1 id={titleId} style={{ margin: 0, fontSize: "1.2rem", fontWeight: 800, color: D.text }}>{title}</h1>
          <button type="button" onClick={onClose} aria-label="Close" style={{ minWidth: 44, minHeight: 44, background: "none", border: "none", color: D.text, fontSize: "1.2rem", cursor: "pointer", fontFamily: "inherit" }}>✕</button>
        </div>
        {children}
      </section>
    </>
  );
}
