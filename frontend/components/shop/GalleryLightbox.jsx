import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { C, tint } from "../../theme.js";
import usePrefersReducedMotion from "../../hooks/usePrefersReducedMotion.js";
import { youtubeEmbedUrl } from "./youtubeEmbed.js";

const FOCUSABLE = 'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

const navBtn = {
  position: "absolute", top: "50%", transform: "translateY(-50%)", width: 44, height: 44, borderRadius: 22,
  border: `1px solid ${C.border}`, background: C.surface, color: C.ink, fontSize: 22, cursor: "pointer", zIndex: 2,
};

function TabButton({ selected, label, n, onSelect }) {
  return (
    <button role="tab" aria-selected={selected} onClick={onSelect}
      style={{ padding: "8px 16px", borderRadius: 20, border: `1px solid ${selected ? C.gold : C.line}`, cursor: "pointer",
        background: selected ? C.gold : "transparent", color: selected ? C.darkBrown : C.ink, fontWeight: 700, fontSize: 13 }}>
      {label} ({n})
    </button>
  );
}

// Modal viewer: images and videos in tabs, one slide at a time.
export default function GalleryLightbox({ media = [], startIndex = 0, title = "", onClose }) {
  const reduced = usePrefersReducedMotion();
  const images = media.filter((m) => m.kind === "image");
  const videos = media.filter((m) => m.kind !== "image");
  const start = media[startIndex];
  const [tab, setTab] = useState(start && start.kind !== "image" ? "videos" : "images");
  const list = tab === "videos" ? videos : images;
  const [idx, setIdx] = useState(() => {
    const own = start && (start.kind === "image" ? images : videos);
    const i = own ? own.indexOf(start) : 0;
    return Math.max(i, 0);
  });
  const dialog = useRef(null);
  const closeBtn = useRef(null);
  const videoEl = useRef(null);
  const returnTo = useRef(typeof document !== "undefined" ? document.activeElement : null);

  const pause = () => { try { videoEl.current?.pause(); } catch { /* not playing */ } };
  const go = useCallback((next) => {
    pause();
    setIdx(next);
  }, []);
  const step = (d) => { if (list.length) go((idx + d + list.length) % list.length); };
  const switchTab = (t) => { pause(); setTab(t); setIdx(0); };

  useEffect(() => {
    closeBtn.current?.focus();
    const back = returnTo.current;
    return () => {
      if (back && back.isConnected && typeof back.focus === "function") back.focus();
    };
  }, []);

  const onKeyDown = (e) => {
    if (e.key === "Escape") { e.stopPropagation(); pause(); onClose?.(); }
    else if (e.key === "ArrowRight") step(1);
    else if (e.key === "ArrowLeft") step(-1);
    else if (e.key === "Tab" && dialog.current) {
      const nodes = [...dialog.current.querySelectorAll(FOCUSABLE)];
      if (!nodes.length) return;
      const first = nodes[0], last = nodes[nodes.length - 1];
      const inside = dialog.current.contains(document.activeElement);
      if (!inside) { e.preventDefault(); (e.shiftKey ? last : first).focus(); }
      else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  };
  // Keys work wherever focus has drifted to, as well as inside the dialog.
  useEffect(() => {
    const h = (e) => { if (!dialog.current?.contains(e.target)) onKeyDown(e); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  });
  useEffect(() => () => pause(), []);

  const cur = list[Math.min(idx, list.length - 1)];

  const slide = !cur ? null : cur.kind === "image" ? (
    <img key={cur.id} data-testid="lightbox-slide" className="gl-slide" src={cur.url} alt={title}
      style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
  ) : cur.kind === "video" ? (
    <video key={cur.id} ref={videoEl} data-testid="lightbox-slide" className="gl-slide" src={cur.url} poster={cur.thumb_url || undefined}
      controls playsInline preload="metadata" style={{ maxWidth: "100%", maxHeight: "100%" }} />
  ) : youtubeEmbedUrl(cur.youtube_id) ? (
    <iframe key={cur.id} className="gl-slide" title={`${title} video`} src={youtubeEmbedUrl(cur.youtube_id)}
      allow="encrypted-media; picture-in-picture; fullscreen" allowFullScreen referrerPolicy="strict-origin-when-cross-origin"
      style={{ width: "min(100%, 800px)", aspectRatio: "16 / 9", border: 0 }} />
  ) : (
    <div style={{ color: C.inkDim, fontSize: 14 }}>This video can't be shown.</div>
  );

  return createPortal(
    <div data-testid="lightbox-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
      style={{ position: "fixed", inset: 0, zIndex: 1000, background: tint(C.void, "e6"), display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <style>{`
        .gl-body{display:flex;flex-direction:column;gap:12px;}
        .gl-grid{display:flex;gap:8px;overflow-x:auto;}
        @media (min-width: 900px){
          .gl-body{flex-direction:row;}
          .gl-grid{flex-direction:column;overflow-y:auto;overflow-x:hidden;width:96px;max-height:70vh;}
        }
        ${reduced ? "" : ".gl-slide{animation:glfade .2s ease;}@keyframes glfade{from{opacity:0}to{opacity:1}}"}
      `}</style>
      <div ref={dialog} role="dialog" aria-modal="true" onKeyDown={onKeyDown} aria-label={`${title} gallery`}
        style={{ background: C.surface, color: C.ink, border: `1px solid ${C.border}`, borderRadius: 12, boxShadow: C.shadow,
          width: "min(1100px, 100%)", maxHeight: "100%", padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div role="tablist" style={{ display: "flex", gap: 8, flex: 1 }}>
            {images.length > 0 && <TabButton selected={tab === "images"} label="Images" n={images.length} onSelect={() => switchTab("images")} />}
            {videos.length > 0 && <TabButton selected={tab === "videos"} label="Videos" n={videos.length} onSelect={() => switchTab("videos")} />}
          </div>
          <button ref={closeBtn} onClick={onClose} aria-label="Close"
            style={{ width: 36, height: 36, borderRadius: 18, border: `1px solid ${C.line}`, background: C.surface2, color: C.ink, fontSize: 18, cursor: "pointer" }}>×</button>
        </div>
        <div className="gl-body">
          <div style={{ position: "relative", flex: 1, minHeight: 280, height: "min(70vh, 640px)", display: "flex", alignItems: "center", justifyContent: "center", background: C.surface2, borderRadius: 8, overflow: "hidden" }}>
            {list.length > 1 && <button aria-label="Previous" onClick={() => step(-1)} style={{ ...navBtn, left: 8 }}>‹</button>}
            {slide}
            {list.length > 1 && <button aria-label="Next" onClick={() => step(1)} style={{ ...navBtn, right: 8 }}>›</button>}
          </div>
          {list.length > 1 && (
            <div className="gl-grid">
              {list.map((m, i) => (
                <button key={m.id} data-testid="lightbox-thumb" aria-label={`Show item ${i + 1}`} aria-current={i === idx} onClick={() => go(i)}
                  style={{ flex: "0 0 auto", width: 80, height: 80, padding: 0, borderRadius: 6, overflow: "hidden", cursor: "pointer", background: C.surface2,
                    border: `2px solid ${i === idx ? C.gold : C.line}` }}>
                  {(m.kind === "image" ? m.url : m.thumb_url)
                    ? <img src={m.kind === "image" ? m.thumb_url || m.url : m.thumb_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    : <span style={{ fontSize: 22, color: C.inkDim }}>▶</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
