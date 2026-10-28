import { useCallback, useState } from 'react'
import { apiPost } from '../apiClient.js'
import { apiErrorMessage } from '../lib/apiErrorMessage.js'

// Notify-me sign-up (POST /api/storefront/notify-me/ {phone?, email?}). A
// plain apiPost in a callback (no useMutation, per frontend/CLAUDE.md), with
// the form's state kept here so the form stays presentational.
// → { submit({phone, email}), saving, saved, error }
export function useNotifyMe() {
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState(null)

  const submit = useCallback(async ({ phone = '', email = '' } = {}) => {
    const body = {}
    if (phone.trim()) body.phone = phone.trim()
    if (email.trim()) body.email = email.trim()
    setError(null)
    if (!body.phone && !body.email) {
      setError('Enter a phone number or an email.')
      return false
    }
    setSaving(true)
    try {
      await apiPost('/api/storefront/notify-me/', body)
      setSaved(true)
      return true
    } catch (err) {
      setError(err?.status === 429
        ? 'Too many tries. Please wait a minute and try again.'
        : apiErrorMessage(err, 'Could not save that. Please try again.'))
      return false
    } finally {
      setSaving(false)
    }
  }, [])

  return { submit, saving, saved, error }
}

// The opt-out link in the opening message (POST .../notify-me/stop/ {token}).
// The server answers the same for any token, so the page shows one fixed line.
export function stopNotifyMe(token) {
  return apiPost('/api/storefront/notify-me/stop/', { token })
}
