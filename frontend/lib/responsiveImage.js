// Responsive listing photos (review FE-05). The API sends each photo with resized WebP copies
// ({thumb: 320, medium: 800, large: 1600}); a missing size already falls back to the original's URL, so a
// phone on mobile data picks a small file and a desktop a larger one, and a row without copies still works.
const WIDTHS = [["thumb", 320], ["medium", 800], ["large", 1600]];

// {src, srcSet?, sizes?, loading, decoding} to spread onto an <img>. `src` is the medium copy (a sensible
// default for browsers that ignore srcset). `eager` is for the one image above the fold (the largest
// contentful paint); everything else loads lazily. Pass the page's real `sizes` (the width the image is shown at).
export function pictureProps(variants, original, { sizes, eager = false } = {}) {
  const base = { loading: eager ? "eager" : "lazy", decoding: "async" };
  if (!variants) return { src: original || undefined, ...base };
  const seen = new Set();
  const parts = [];
  for (const [name, width] of WIDTHS) {
    const url = variants[name];
    if (!url || seen.has(url)) continue;
    seen.add(url);
    parts.push(`${url} ${width}w`);
  }
  return {
    src: variants.medium || original || undefined,
    ...(parts.length > 1 ? { srcSet: parts.join(", "), sizes: sizes || "100vw" } : {}),
    ...base,
  };
}

// The photo a card shows: the main photo, else the first gallery photo (owner-uploaded galleries have no
// main_photo). {url, variants} or null; never invents a picture.
export function cardPhoto(item) {
  if (item?.main_photo) return { url: item.main_photo, variants: item.main_photo_variants || null };
  const first = item?.photos?.[0];
  return first?.image ? { url: first.image, variants: first.variants || null } : null;
}
