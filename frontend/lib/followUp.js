// Follow-up dates on the scout screens. A scout picks a day; the server wants
// a moment in the future, so the day becomes 17:00 local that day (the hour a
// business has usually closed), or 23:59 when today's 17:00 has already gone.

const pad = (n) => String(n).padStart(2, '0')

// <input type="date"> value for a Date, in local time.
export function dateInputValue(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function followUpIso(dateValue, now = new Date()) {
  if (!dateValue) return null
  const [y, m, d] = dateValue.split('-').map(Number)
  const evening = new Date(y, m - 1, d, 17, 0, 0)
  return (evening > now ? evening : new Date(y, m - 1, d, 23, 59, 0)).toISOString()
}

// "Friday 9 October"
export function longDay(dateValue) {
  if (!dateValue) return ''
  const [y, m, d] = dateValue.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
}

// "Fri 9 Oct"
export function shortDay(value) {
  const date = value instanceof Date ? value : new Date(value)
  return date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
}

export const isBeforeToday = (value, now = new Date()) => {
  const date = new Date(value)
  return dateInputValue(date) < dateInputValue(now)
}
