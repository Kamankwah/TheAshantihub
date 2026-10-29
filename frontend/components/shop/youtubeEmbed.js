// The only YouTube URL the gallery will ever frame: an 11-character id on the
// privacy-enhanced domain. Anything else yields null (no iframe at all).
const YT_ID = /^[\w-]{11}$/

export function youtubeEmbedUrl(id) {
  return YT_ID.test(id || "") ? `https://www.youtube-nocookie.com/embed/${id}` : null
}
