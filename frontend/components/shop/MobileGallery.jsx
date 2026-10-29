import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { C, tint } from "../../theme.js";
import { clampPan, distance, isSwipe, nextScale } from "../../lib/pinchMath.js";
import { youtubeEmbedUrl } from "./youtubeEmbed.js";

const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_PX = 30;
const TAP_SLOP = 10;
const DOUBLE_TAP_SCALE = 2;

const ctl = {
  width: 44, height: 44, borderRadius: 22, border: `1px solid ${tint(C.cream, "40")}`, background: tint(C.void, "b3"),
  color: C.cream, fontSize: 22, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0,
};

// Full-screen phone viewer. Images take pointer gestures (pinch 1-4x, drag to
// pan when zoomed, double-tap 2x, swipe at 1x); videos keep their own controls
// and step with Previous / Next. One history entry is pushed on open so the
// Back button closes the viewer instead of leaving the page.
export default function MobileGallery({ media = [], startIndex = 0, title = "", onClose }) {
  const [idx, setIdx] = useState(() => Math.min(Math.max(startIndex, 0), Math.max(media.length - 1, 0)));
  const [view, setView] = useState({ scale: 1, pan: { x: 0, y: 0 } });
  const viewRef = useRef(view);
  viewRef.current = view;
  const surface = useRef(null);
  const closeBtn = useRef(null);
  const videoEl = useRef(null);
  const pointers = useRef(new Map()); // pointerId -> {x, y}
  const g = useRef({ start: null, panStart: { x: 0, y: 0 }, pinch: null, moved: 0, multi: false, dbl: false, lastTap: null });
  const closed = useRef(false);
  const token = useRef(null);
  const mounted = useRef(false);
  const prevOverflow = useRef(null);
  const returnTo = useRef(typeof document !== "undefined" ? document.activeElement : null);

  const cur = media[idx];
  const isImage = cur?.kind === "image";

  const pause = () => { try { videoEl.current?.pause(); } catch { /* not playing */ } };
  const restoreScroll = () => {
    if (prevOverflow.current !== null) { document.body.style.overflow = prevOverflow.current; prevOverflow.current = null; }
  };
  const ours = () => token.current !== null && window.history.state && window.history.state.ahMobileGallery === token.current;

  // Close from our own UI: restore scroll, drop our history entry only if it is
  // still the current one (never send the user back a page), then tell the parent.
  const close = useCallback(() => {
    if (closed.current) return;
    closed.current = true;
    pause();
    restoreScroll();
    if (ours()) window.history.back();
    token.current = null; // entry handed back; nothing left for unmount to pop
    onClose?.();
  }, [onClose]);

  useEffect(() => {
    // React StrictMode (dev) runs mount, cleanup, mount on the same instance, so
    // every mount re-arms the instance and reuses a history entry that is still ours.
    mounted.current = true;
    closed.current = false;
    prevOverflow.current = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    if (!ours()) {
      token.current = `${Date.now()}-${Math.random()}`;
      window.history.pushState({ ...(window.history.state || {}), ahMobileGallery: token.current }, "");
    }
    const onPop = () => {
      if (closed.current) return;
      closed.current = true; // Back already removed our entry
      token.current = null;
      pause();
      restoreScroll();
      onClose?.();
    };
    window.addEventListener("popstate", onPop);
    closeBtn.current?.focus();
    const back = returnTo.current;
    return () => {
      window.removeEventListener("popstate", onPop);
      restoreScroll();
      mounted.current = false;
      // A parent unmounting us while open should not leave a stray entry. The
      // pop is deferred one tick: StrictMode's immediate remount sets mounted
      // again and keeps the entry, a real unmount does not.
      setTimeout(() => {
        if (!mounted.current && !closed.current && ours()) { token.current = null; window.history.back(); }
      }, 0);
      if (back && back.isConnected && typeof back.focus === "function") back.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const go = (next) => {
    if (!media.length) return;
    pause();
    setIdx((next + media.length) % media.length);
    setView({ scale: 1, pan: { x: 0, y: 0 } });
    g.current.lastTap = null;
  };
  const step = (d) => go(idx + d);

  useEffect(() => {
    const h = (e) => {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowRight") step(1);
      else if (e.key === "ArrowLeft") step(-1);
    };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  });

  const boxSize = () => {
    const r = surface.current?.getBoundingClientRect();
    return { w: r?.width || window.innerWidth, h: r?.height || window.innerHeight };
  };
  const rebase = () => {
    const first = [...pointers.current.values()][0];
    g.current.start = first ? { ...first } : null;
    g.current.panStart = { ...viewRef.current.pan };
    g.current.multi = true; // a gesture that involved a pinch is never a tap or a swipe
  };

  const onDown = (e) => {
    try { surface.current?.setPointerCapture?.(e.pointerId); } catch { /* not capturable */ }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) {
      const now = Date.now();
      const lt = g.current.lastTap;
      let dbl = false;
      if (lt && now - lt.t <= DOUBLE_TAP_MS && Math.hypot(e.clientX - lt.x, e.clientY - lt.y) <= DOUBLE_TAP_PX) {
        g.current.lastTap = null;
        dbl = true;
        const zoomed = viewRef.current.scale > 1;
        setView({ scale: zoomed ? 1 : DOUBLE_TAP_SCALE, pan: { x: 0, y: 0 } });
      }
      g.current.start = { x: e.clientX, y: e.clientY };
      g.current.panStart = { ...viewRef.current.pan };
      g.current.moved = 0;
      g.current.multi = false;
      g.current.dbl = dbl;
    } else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      g.current.pinch = { dist: distance(a, b), scale: viewRef.current.scale };
      g.current.multi = true;
    }
  };

  const onMove = (e) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size >= 2 && g.current.pinch) {
      const [a, b] = [...pointers.current.values()];
      const scale = nextScale(g.current.pinch.scale, g.current.pinch.dist, distance(a, b));
      setView((v) => ({ scale, pan: clampPan(v.pan, scale, boxSize()) }));
    } else if (pointers.current.size === 1 && g.current.start) {
      const dx = e.clientX - g.current.start.x;
      const dy = e.clientY - g.current.start.y;
      g.current.moved = Math.max(g.current.moved, Math.hypot(dx, dy));
      if (viewRef.current.scale > 1) {
        const pan = clampPan({ x: g.current.panStart.x + dx, y: g.current.panStart.y + dy }, viewRef.current.scale, boxSize());
        setView((v) => ({ ...v, pan }));
      }
    }
  };

  const onUp = (e) => {
    const was = pointers.current.get(e.pointerId);
    if (!was) return;
    pointers.current.delete(e.pointerId);
    try { surface.current?.releasePointerCapture?.(e.pointerId); } catch { /* already released */ }
    if (pointers.current.size === 1) { g.current.pinch = null; rebase(); return; }
    if (pointers.current.size > 0) return;
    g.current.pinch = null;
    const start = g.current.start;
    g.current.start = null;
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (g.current.multi) return;
    if (isSwipe(dx, dy, { scale: viewRef.current.scale })) {
      step(dx < 0 ? 1 : -1);
    } else if (g.current.moved <= TAP_SLOP && !g.current.dbl) {
      g.current.lastTap = { t: Date.now(), x: e.clientX, y: e.clientY };
    }
  };
  const onCancel = (e) => {
    pointers.current.delete(e.pointerId);
    if (!pointers.current.size) { g.current.start = null; g.current.pinch = null; }
  };

  let body = null;
  if (cur) {
    if (cur.kind === "image") {
      body = (
        <div ref={surface} data-testid="mg-surface" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onCancel}
          style={{ position: "absolute", inset: 0, touchAction: "none", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", userSelect: "none" }}>
          <div data-testid="mg-zoom" style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center",
            transform: `translate(${view.pan.x}px, ${view.pan.y}px) scale(${view.scale})`, transformOrigin: "center center", willChange: "transform" }}>
            <img key={cur.id} data-testid="mg-slide" src={cur.url} alt={title} draggable={false}
              style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", display: "block", pointerEvents: "none" }} />
          </div>
        </div>
      );
    } else if (cur.kind === "video") {
      body = (
        <div data-testid="mg-surface-media" style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <video key={cur.id} ref={videoEl} data-testid="mg-slide" src={cur.url} poster={cur.thumb_url || undefined}
            controls playsInline preload="metadata" style={{ maxWidth: "100%", maxHeight: "100%" }} />
        </div>
      );
    } else {
      const src = youtubeEmbedUrl(cur.youtube_id);
      body = (
        <div data-testid="mg-surface-media" style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
          {src ? (
            <iframe key={cur.id} title={`${title} video`} src={src} allow="encrypted-media; picture-in-picture; fullscreen" allowFullScreen
              referrerPolicy="strict-origin-when-cross-origin" style={{ width: "100%", aspectRatio: "16 / 9", border: 0 }} />
          ) : (
            <div style={{ color: C.cream, fontSize: 14 }}>This video can't be shown.</div>
          )}
        </div>
      );
    }
  }

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={`${title} gallery`}
      style={{ position: "fixed", top: 0, left: 0, width: "100%", height: "100dvh", zIndex: 1000, background: C.void, color: C.cream, overflow: "hidden" }}>
      {body}
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "max(12px, env(safe-area-inset-top)) 12px 12px", pointerEvents: "none" }}>
        <span aria-live="polite" style={{ pointerEvents: "auto", padding: "6px 12px", borderRadius: 16, background: tint(C.void, "b3"), color: C.cream, fontSize: 13, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
          {media.length ? `${idx + 1} / ${media.length}` : "0 / 0"}
        </span>
        <button ref={closeBtn} onClick={close} aria-label="Close" style={{ ...ctl, pointerEvents: "auto" }}>×</button>
      </div>
      {!isImage && media.length > 1 && (
        <>
          <button aria-label="Previous" onClick={() => step(-1)} style={{ ...ctl, position: "absolute", left: 8, bottom: "max(16px, env(safe-area-inset-bottom))" }}>‹</button>
          <button aria-label="Next" onClick={() => step(1)} style={{ ...ctl, position: "absolute", right: 8, bottom: "max(16px, env(safe-area-inset-bottom))" }}>›</button>
        </>
      )}
    </div>,
    document.body
  );
}
