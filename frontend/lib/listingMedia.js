// Adapts a listing detail (main_photo, photos, videos) to the gallery's media
// list: [{id, kind: "image"|"video"|"youtube", url, thumb_url, youtube_id, position}].
// Never invents a URL; entries without a usable one are skipped (a video still
// converting has no web file yet).
const MAX_IMAGES = 9
const MAX_VIDEOS = 2

export function mediaOf(item) {
  if (!item) return []
  const out = []
  const seen = new Set()
  const addImage = (id, url) => {
    if (!url || seen.has(url) || seen.size >= MAX_IMAGES) return
    seen.add(url)
    out.push({ id, kind: 'image', url, thumb_url: url, youtube_id: null, position: out.length })
  }
  addImage('main', item.main_photo)
  const photos = [...(item.photos || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  photos.forEach((p) => addImage(p.id, p.image))

  let videos = 0
  const sorted = [...(item.videos || [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
  for (const v of sorted) {
    if (videos >= MAX_VIDEOS) break
    if (v.kind === 'youtube') {
      if (!v.youtube_id) continue
      out.push({ id: v.id, kind: 'youtube', url: null, thumb_url: v.poster || null, youtube_id: v.youtube_id, position: out.length })
    } else {
      if (!v.url) continue
      out.push({ id: v.id, kind: 'video', url: v.url, thumb_url: v.poster || null, youtube_id: null, position: out.length })
    }
    videos += 1
  }
  return out
}
