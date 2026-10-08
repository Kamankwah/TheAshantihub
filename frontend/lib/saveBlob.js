// Saves a Blob to the user's device under `filename` (an authenticated file
// download, the recovery-codes text file). One implementation for every
// caller: a temporary object URL and a clicked <a download>.
export function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
