import { useEffect, useRef, useState } from "react";
import { C } from "../theme.js";

// Result messages (role="alert" / role="status") are rendered next to the form or list they belong to, which
// is often far above or below the button the user just pressed. When one appears off screen (or clipped by a
// scrolling panel) after a user action, this shows the same text as a small fixed notice so the user sees the
// outcome without scrolling and without the page moving. It never scrolls anything. The original element stays
// in place and remains the live region screen readers hear; the echo is not a live region.
const ACTION_WINDOW_MS = 15000; // a result counts as "from the user's action" if it appears this soon after one
const SHOW_MS = 7000;
const MAX_SHOWN = 3;
const LOADING = /^\s*(loading|please wait|working|sending|saving|…|\.\.\.)/i;

const feedbackNodes = (node) => {
  if (!(node instanceof Element)) return [];
  const own = node.matches?.('[role="alert"],[role="status"]') ? [node] : [];
  return [...own, ...node.querySelectorAll('[role="alert"],[role="status"]')];
};

export default function FeedbackEcho() {
  const [items, setItems] = useState([]);
  const lastAction = useRef(0);
  const seen = useRef(new WeakMap()); // element -> last text echoed
  const idRef = useRef(0);

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined" || typeof MutationObserver === "undefined") return undefined;
    const mark = () => { lastAction.current = Date.now(); };
    const events = ["click", "submit", "change", "keydown"];
    events.forEach((e) => document.addEventListener(e, mark, true));

    const echo = (el, text) => {
      const id = ++idRef.current;
      const kind = el.getAttribute("role") === "alert" ? "error" : "ok";
      setItems((list) => [...list.filter((i) => i.text !== text), { id, text, kind }].slice(-MAX_SHOWN));
      setTimeout(() => setItems((list) => list.filter((i) => i.id !== id)), SHOW_MS);
    };

    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        io.unobserve(entry.target);
        if (entry.intersectionRatio >= 0.6) return;
        const text = entry.target.textContent?.trim();
        if (text) echo(entry.target, text);
      });
    }, { threshold: [0, 0.6, 1] });

    const consider = (el) => {
      if (Date.now() - lastAction.current > ACTION_WINDOW_MS) return;
      if (el.closest("[data-feedback-echo]") || el.closest('[aria-hidden="true"]')) return;
      const text = el.textContent?.trim();
      if (!text || LOADING.test(text) || seen.current.get(el) === text) return;
      seen.current.set(el, text);
      io.observe(el);
    };

    const mo = new MutationObserver((records) => {
      records.forEach((r) => {
        if (r.type === "childList") r.addedNodes.forEach((n) => feedbackNodes(n).forEach(consider));
        const target = r.target instanceof Element ? r.target : r.target.parentElement;
        const host = target?.closest?.('[role="alert"],[role="status"]');
        if (host && r.type !== "attributes") consider(host);
      });
    });
    mo.observe(document.body, { childList: true, subtree: true, characterData: true });

    return () => {
      events.forEach((e) => document.removeEventListener(e, mark, true));
      mo.disconnect();
      io.disconnect();
    };
  }, []);

  if (items.length === 0) return null;
  return (
    <div data-feedback-echo style={{ position: "fixed", left: 0, right: 0, bottom: "calc(16px + env(safe-area-inset-bottom, 0px))", zIndex: 100000, display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: "0 12px", pointerEvents: "none" }}>
      {items.map((item) => (
        <div key={item.id} style={{ pointerEvents: "auto", maxWidth: 480, width: "100%", display: "flex", gap: 10, alignItems: "flex-start", background: C.surface, color: C.ink, border: `1px solid ${C.line}`, borderLeft: `4px solid ${item.kind === "error" ? C.danger : C.trust}`, borderRadius: 10, padding: "10px 12px", boxShadow: "0 6px 24px rgba(0,0,0,0.25)", fontSize: "0.84rem", lineHeight: 1.4 }}>
          <span style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>{item.text}</span>
          <button type="button" aria-label="Dismiss message" onClick={() => setItems((list) => list.filter((i) => i.id !== item.id))} style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", fontSize: "1.25rem", lineHeight: 1, padding: 0, minWidth: 44, minHeight: 44 }}>×</button>
        </div>
      ))}
    </div>
  );
}
