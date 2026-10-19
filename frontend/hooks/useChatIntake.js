import { useCallback, useState } from 'react'
import { apiPost } from '../apiClient.js'
import { apiErrorMessage } from '../lib/apiErrorMessage.js'
import { getGuestToken } from './useMyConversations.js'

// The server's field names, mapped to the intake step that owns each.
const FIELD_STEP = { contact_name: 'name', contact_email: 'email', contact_phone: 'phone', body: 'issue' }

// Chat intake (POST /api/messaging/conversations/, source "chatbot"): hands a
// visitor's name, email, phone and issue to AshantiHub Support as an ordinary
// Conversation with no business attached. A plain apiPost (no useMutation, per
// frontend/CLAUDE.md). A signed-in customer/owner is scoped by their token; an
// anonymous visitor sends the same browser guest token MessagingCenter uses, so
// Support's replies show up in the existing thread.
// → { submit({name, email, phone, issue}) -> conversation | null,
//     error: {step, message} | null, busy }
export function useChatIntake({ signedIn = false } = {}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const submit = useCallback(async ({ name, email, phone, issue }) => {
    setBusy(true)
    setError(null)
    try {
      return await apiPost('/api/messaging/conversations/', {
        subject: 'Chat assistant',
        body: issue.trim(),
        source: 'chatbot',
        contact_name: name.trim(),
        contact_email: email.trim(),
        contact_phone: phone.trim(),
        ...(signedIn ? {} : { guest_token: getGuestToken() }),
      })
    } catch (err) {
      const field = Object.keys(FIELD_STEP).find((k) => err?.body && err.body[k])
      setError({
        step: field ? FIELD_STEP[field] : 'issue',
        message: apiErrorMessage(err, 'Could not send your message. Please try again.'),
      })
      return null
    } finally {
      setBusy(false)
    }
  }, [signedIn])

  return { submit, error, busy }
}
