// Compact durations for staff screens: "40 min", "5 h", "3 d".
export function formatDuration(ms) {
  const minutes = Math.max(0, Math.round(ms / 60000))
  if (minutes < 1) return 'under a minute'
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours} h`
  return `${Math.floor(hours / 24)} d`
}

export function timeAgo(iso, now = Date.now()) {
  const then = iso ? new Date(iso).getTime() : NaN
  return Number.isNaN(then) ? '' : formatDuration(now - then)
}

// A pending approval's clock: when it moves to the next approver, or how
// long it has been overdue.
export function describeWait(dueIso, now = Date.now()) {
  const due = dueIso ? new Date(dueIso).getTime() : NaN
  if (Number.isNaN(due)) return ''
  const left = due - now
  if (left >= 0) return `moves on in ${formatDuration(left)}`
  const late = formatDuration(-left)
  return late === 'under a minute' ? 'overdue just now' : `overdue by ${late}`
}

// "Mon 5 Oct" and "09:10" in Ghana's format, for queue rows and timelines.
export function shortDay(iso) {
  const date = iso ? new Date(iso) : null
  return date && !Number.isNaN(date.getTime()) ? date.toLocaleDateString('en-GH', { weekday: 'short', day: 'numeric', month: 'short' }).replace(',', '') : ''
}

export function clockTime(iso) {
  const date = iso ? new Date(iso) : null
  return date && !Number.isNaN(date.getTime()) ? date.toLocaleTimeString('en-GH', { hour: '2-digit', minute: '2-digit', hour12: false }) : ''
}
