// Money helpers. Amounts travel as decimal strings; nothing here uses float
// maths, so what the server sent is what is shown.

// Only decides whether a request is worth sending; the server's message still wins.
export function isPlausibleAmount(text) {
  if (typeof text !== 'string') return false
  const match = /^([0-9]{1,10})(?:\.([0-9]{1,2}))?$/.exec(text)
  return Boolean(match) && /[1-9]/.test(text)
}

function group(intPart) {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

// "1250.5" -> "GH₵ 1,250.50", from the server's string.
export function formatGhs(value) {
  if (value === null || value === undefined || value === '') return ''
  const match = /^(-?)(\d+)(?:\.(\d*))?$/.exec(String(value).trim())
  if (!match) return String(value)
  const [, sign, whole, frac = ''] = match
  return `${sign}GH₵ ${group(whole.replace(/^0+(?=\d)/, ''))}.${(frac + '00').slice(0, 2)}`
}

// For the 7C held-top-up field only, which is sent as whole pesewas.
export function pesewasToGhs(pesewas) {
  const n = Math.trunc(Number(pesewas) || 0)
  const abs = Math.abs(n)
  return formatGhs(`${n < 0 ? '-' : ''}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`)
}

export function newRequestId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

// An ISO time as Accra date and time ("21 Oct 2026, 14:05"), or null if unusable.
const DATE = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Accra', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
export function formatWhen(iso) {
  const d = iso ? new Date(iso) : null
  return d && !Number.isNaN(d.getTime()) ? DATE.format(d) : null
}
