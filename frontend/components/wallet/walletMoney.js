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

// A value that can be below zero: the leading "-" becomes the real minus sign
// (U+2212) before the currency, "-13.50" -> "−GH₵ 13.50". Anything else is formatGhs.
export function signedGhs(value) {
  const text = value === null || value === undefined ? '' : String(value).trim()
  return text.startsWith('-') ? `−${formatGhs(text.slice(1))}` : formatGhs(value)
}

// "12.5" -> 1250 (whole pesewas), or null when the text is not a plain GHS
// amount. Integer parsing only, for display comparisons and sums.
export function ghsToPesewas(text) {
  const match = /^(\d{1,10})(?:\.(\d{0,2}))?$/.exec(String(text ?? '').trim())
  if (!match) return null
  return Number(match[1]) * 100 + Number(((match[2] ?? '') + '00').slice(0, 2))
}

// amount (a number or a decimal string) + a server GHS string, summed in whole
// pesewas and shown with two decimals ("301.50"); null if either is unusable.
export function addGhs(amount, serverText) {
  const a = typeof amount === 'number' ? Math.round(amount * 100) : ghsToPesewas(amount)
  const b = ghsToPesewas(serverText)
  if (a === null || b === null || Number.isNaN(a)) return null
  const sum = a + b
  return `${Math.floor(sum / 100)}.${String(sum % 100).padStart(2, '0')}`
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

// A signed amount for the owner and rider screens: "-5.00" -> "−GH₵ 5.00" (U+2212 before the
// currency, the glyph TransactionsList shows); anything else is formatGhs as is.
// formatGhs itself is unchanged: it writes an ASCII hyphen, which WalletsPanel.test pins.
export function signedGhs(value) {
  const text = String(value ?? '').trim()
  return text.startsWith('-') ? `−${formatGhs(text.slice(1))}` : formatGhs(text)
}
