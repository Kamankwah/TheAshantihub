import { apiErrorMessage } from '../../lib/apiErrorMessage.js'

// The server's refusal code (`error.body.code`), or null.
export function refusalCode(error) {
  return error?.body?.code ?? null
}

// {text, kind} for a thrown apiClient error. kind: "off" (ledger switched
// off), "stepup" (the code prompt was cancelled, so the 403 reached us),
// "error". Otherwise the server's own words are shown verbatim.
export function walletMessage(error) {
  const code = refusalCode(error)
  if (error?.status === 409 && code === 'ledger_off') return { text: "Wallets aren't switched on yet.", kind: 'off' }
  if (error?.status === 403 && code === 'step_up_required') {
    return { text: 'We need to confirm it is you. Try again and enter the code.', kind: 'stepup' }
  }
  return { text: apiErrorMessage(error, 'Something went wrong. Try again.'), kind: 'error' }
}
