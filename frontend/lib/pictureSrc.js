// The <img> attributes for a category or zone picture: the small resized copies (listings.image_variants, made on
// upload) with the original as the fallback for a row that has none yet (uploaded before copies existed, or a copy
// that could not be made). `sizes` is the width the picture is drawn at in CSS pixels, so the browser picks the
// 320 or 800 px copy for the screen's density.
export function pictureProps(node, sizes) {
  if (!node?.image) return null
  const v = node.image_variants
  if (!v?.thumb || !v?.medium || v.thumb === node.image) return { src: v?.thumb || node.image }
  return { src: v.thumb, srcSet: `${v.thumb} 320w, ${v.medium} 800w`, sizes }
}
