// Rider wallet display helpers. Whole-number maths only; the server's strings are
// shown as sent.

// Basis points as a percentage: 1000 -> "10%", 1050 -> "10.5%", 1234 -> "12.34%".
export function percentFromBp(bp) {
  const n = Math.trunc(Number(bp) || 0)
  const whole = Math.trunc(n / 100)
  const frac = String(Math.abs(n % 100)).padStart(2, '0').replace(/0+$/, '')
  return `${whole}${frac ? `.${frac}` : ''}%`
}

// A GH₵ string below zero begins with a minus sign.
export function isBelowZero(ghs) {
  return typeof ghs === 'string' && ghs.trim().startsWith('-')
}

const WHEN = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Africa/Accra', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
})

// "00:00 on Wed 21 Oct (Accra time)", whatever the device's time zone; '' when unusable.
export function accraWhen(iso) {
  const d = iso ? new Date(iso) : null
  if (!d || Number.isNaN(d.getTime())) return ''
  const p = Object.fromEntries(WHEN.formatToParts(d).map((part) => [part.type, part.value]))
  return `${p.hour}:${p.minute} on ${p.weekday} ${p.day} ${p.month} (Accra time)`
}
