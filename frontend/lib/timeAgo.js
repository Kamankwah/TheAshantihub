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
  return formatDuration(now - new Date(iso).getTime())
}

// A pending approval's clock: when it moves to the next approver, or how
// long it has been overdue.
export function describeWait(dueIso, now = Date.now()) {
  const left = new Date(dueIso).getTime() - now
  return left >= 0 ? `moves on in ${formatDuration(left)}` : `overdue by ${formatDuration(-left)}`
}
