import { useEffect, useRef, useState } from "react";
import { C, tint } from "../../theme.js";
import { lensRect, paneOffset } from "../../lib/zoomMath.js";
import useBreakpoint from "../../hooks/useBreakpoint.js";
import GalleryLightbox from "./GalleryLightbox.jsx";
import MobileGallery from "./MobileGallery.jsx";

const ZOOM = 2.5;
const CAN_HOVER = "(hover: hover) and (pointer: fine)";
const canHover = () => typeof window !== "undefined" && !!window.matchMedia && window.matchMedia(CAN_HOVER).matches;

// Main image + thumbnail rail + hover-zoom pane + lightbox. `media` is the
// list built by lib/listingMedia.js. The zoom pane sits to the right of the
// gallery, over the buy-box column, and only exists for a fine hovering pointer.
export default function ProductGallery({ media = [], title = "", activeVariantImage = null, onOpen }) {
  const images = media.filter((m) => m.kind === "image");
  const videos = media.filter((m) => m.kind !== "image");
  const [idx, setIdx] = useState(0);
  const [lightbox, setLightbox] = useState(null); // index into media, or null
  const [zoom, setZoom] = useState(null); // {lens, offset, box} while hovering
  const [hovering, setHovering] = useState(false);
  const box = useRef(null);
  const phone = useBreakpoint() === "phone";

  useEffect(() => { if (activeVariantImage) setIdx(0); }, [activeVariantImage]);
  useEffect(() => { if (idx >= images.length) setIdx(0); }, [images.length, idx]);

  const current = images[idx];
  const mainSrc = activeVariantImage || current?.url || null;

  const open = (i) => { onOpen?.(i); setLightbox(Math.max(media.indexOf(images[i]), 0)); };

  const onEnter = () => { if (mainSrc && canHover()) setHovering(true); };
  const onMove = (e) => {
    if (!hovering || !box.current) return;
    const r = box.current.getBoundingClientRect();
    const b = { w: r.width || 1, h: r.height || 1 };
    const lens = lensRect(b, { x: e.clientX - r.left, y: e.clientY - r.top }, ZOOM, b);
    setZoom({ lens, offset: paneOffset(lens, b, ZOOM), box: b });
  };
  const onLeave = () => { setHovering(false); setZoom(null); };

  if (!media.length && !activeVariantImage) {
    return (
      <div style={{ aspectRatio: "1 / 1", background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", color: C.inkDim, fontSize: 14 }}>
        No photo yet
      </div>
    );
  }

  const onStripScroll = (e) => {
    const w = e.currentTarget.clientWidth || 1;
    const i = Math.round(e.currentTarget.scrollLeft / w);
    if (i !== idx && i >= 0 && i < images.length) setIdx(i);
  };
  const viewer = lightbox === null ? null : phone
    ? <MobileGallery media={media} startIndex={lightbox} title={title} onClose={() => setLightbox(null)} />
    : <GalleryLightbox media={media} startIndex={lightbox} title={title} onClose={() => setLightbox(null)} />;

  if (phone && images.length === 0 && !activeVariantImage) {
    // Videos but no photos: the tile, not a broken <img>; the Videos button opens the viewer.
    return (
      <div>
        <div style={{ aspectRatio: "1 / 1", background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", color: C.inkDim, fontSize: 14 }}>
          No photo yet
        </div>
        {videos.length > 0 && (
          <button onClick={() => setLightbox(media.indexOf(videos[0]))} aria-label={`Videos (${videos.length})`}
            style={{ marginTop: 8, padding: "10px 14px", minHeight: 44, borderRadius: 8, border: `1px solid ${C.line}`, background: C.surface2, color: C.ink, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
            ▶ Videos ({videos.length})
          </button>
        )}
        {viewer}
      </div>
    );
  }

  if (phone) {
    const slides = images.length ? images.map((m, i) => ({ m, src: i === 0 && activeVariantImage ? activeVariantImage : m.url })) : [{ m: null, src: activeVariantImage }];
    return (
      <div>
        <div data-testid="gallery-strip" onScroll={onStripScroll}
          style={{ display: "flex", overflowX: "auto", scrollSnapType: "x mandatory", WebkitOverflowScrolling: "touch", borderRadius: 12, border: `1px solid ${C.line}`, background: C.surface2 }}>
          {slides.map(({ m, src }, i) => (
            <div key={m?.id ?? "variant"} style={{ flex: "0 0 100%", scrollSnapAlign: "center", aspectRatio: "1 / 1", position: "relative" }}>
              <img data-testid="gallery-main-image" src={src} alt={title} style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }} />
              <button aria-label={`Open photo ${i + 1} full screen`} onClick={() => open(Math.min(i, images.length - 1))}
                style={{ position: "absolute", inset: 0, width: "100%", height: "100%", background: "transparent", border: 0, cursor: "zoom-in" }} />
            </div>
          ))}
        </div>
        {images.length > 1 && (
          <div style={{ textAlign: "center", marginTop: 8, fontSize: 12, color: C.inkDim, fontVariantNumeric: "tabular-nums" }}>{Math.min(idx, images.length - 1) + 1} / {images.length}</div>
        )}
        {videos.length > 0 && (
          <button onClick={() => setLightbox(media.indexOf(videos[0]))} aria-label={`Videos (${videos.length})`}
            style={{ marginTop: 8, padding: "10px 14px", minHeight: 44, borderRadius: 8, border: `1px solid ${C.line}`, background: C.surface2, color: C.ink, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
            ▶ Videos ({videos.length})
          </button>
        )}
        {mainSrc && <div style={{ textAlign: "center", marginTop: 8, fontSize: 12, color: C.inkDim }}>Tap to see full screen</div>}
        {viewer}
      </div>
    );
  }

  const railTile = { width: 56, height: 56, padding: 0, borderRadius: 6, overflow: "hidden", cursor: "pointer", background: C.surface2, flex: "0 0 auto" };

  return (
    <div style={{ display: "flex", gap: 12, position: "relative", alignItems: "flex-start" }}>
      {(images.length > 1 || videos.length > 0) && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {images.map((m, i) => (
            <button key={m.id} data-testid="gallery-thumb" aria-label={`Show photo ${i + 1}`} aria-current={i === idx && !activeVariantImage}
              onClick={() => setIdx(i)} style={{ ...railTile, border: `2px solid ${i === idx ? C.gold : C.line}` }}>
              <img src={m.thumb_url || m.url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            </button>
          ))}
          {videos.length > 0 && (
            <button onClick={() => setLightbox(media.indexOf(videos[0]))} aria-label={`Videos (${videos.length})`}
              style={{ ...railTile, border: `2px solid ${C.line}`, color: C.ink, fontSize: 11, fontWeight: 700 }}>
              ▶ Videos ({videos.length})
            </button>
          )}
        </div>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div ref={box} data-testid="gallery-main" onMouseEnter={onEnter} onMouseMove={onMove} onMouseLeave={onLeave}
          style={{ position: "relative", aspectRatio: "1 / 1", background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 12, overflow: "hidden" }}>
          {mainSrc ? (
            <>
              <img data-testid="gallery-main-image" src={mainSrc} alt={title} style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }} />
              <button aria-label="Click to see full view" onClick={() => open(Math.min(idx, images.length - 1))}
                style={{ position: "absolute", inset: 0, width: "100%", height: "100%", background: "transparent", border: 0, cursor: hovering ? "crosshair" : "zoom-in" }} />
              {zoom && (
                <div aria-hidden="true" style={{ position: "absolute", left: zoom.lens.x, top: zoom.lens.y, width: zoom.lens.w, height: zoom.lens.h, border: `1px solid ${C.gold}`, background: tint(C.gold, "1f"), pointerEvents: "none" }} />
              )}
            </>
          ) : (
            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: C.inkDim }}>No photo yet</div>
          )}
        </div>
        {mainSrc && <div style={{ textAlign: "center", marginTop: 8, fontSize: 12, color: C.inkDim }}>Click to see full view</div>}
      </div>
      {hovering && zoom && mainSrc && (
        <div data-testid="zoom-pane" aria-hidden="true"
          style={{ position: "absolute", top: 0, left: "calc(100% + 16px)", width: zoom.box.w, height: zoom.box.h, zIndex: 20, overflow: "hidden", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, boxShadow: C.shadow }}>
          <img src={mainSrc} alt="" style={{ position: "absolute", left: 0, top: 0, width: zoom.box.w * ZOOM, height: zoom.box.h * ZOOM, maxWidth: "none", objectFit: "contain", transform: `translate(${zoom.offset.x}px, ${zoom.offset.y}px)` }} />
        </div>
      )}
      {viewer}
    </div>
  );
}
