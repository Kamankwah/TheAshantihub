import { useCallback, useEffect, useRef, useState } from "react"

// Local avatar-picker state for a controlled upload flow (preview + the raw
// File to submit) — adapted from the generic originui "preview-only" version
// to also expose `file`, since a real submit (AccountProfileCard's Save,
// which PATCHes /api/accounts/customers/me/profile/ as multipart) needs the
// actual File object, not just an object URL to display it.
export function useImageUpload() {
  const previewRef = useRef<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [file, setFile] = useState<File | null>(null)

  const handleThumbnailClick = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const handleFileChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const picked = event.target.files?.[0]
    if (picked) {
      const url = URL.createObjectURL(picked)
      setPreviewUrl(url)
      previewRef.current = url
      setFile(picked)
    }
  }, [])

  const reset = useCallback((fallbackUrl: string | null = null) => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current)
    previewRef.current = null
    setPreviewUrl(fallbackUrl)
    setFile(null)
    if (fileInputRef.current) fileInputRef.current.value = ""
  }, [])

  useEffect(() => {
    return () => {
      if (previewRef.current) URL.revokeObjectURL(previewRef.current)
    }
  }, [])

  return { previewUrl, file, fileInputRef, handleThumbnailClick, handleFileChange, reset }
}
