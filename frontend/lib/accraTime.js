// "Tue 08:00": short weekday + 24-hour time, always in Africa/Accra (the zone businesses' opening hours are kept in),
// whatever the viewer's device clock says. Returns null for a missing or unparseable instant, so callers render nothing.
const FORMAT = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Accra', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

export function formatAccraDayTime(iso) {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const p = Object.fromEntries(FORMAT.formatToParts(d).map((x) => [x.type, x.value]))
  return `${p.weekday} ${p.hour}:${p.minute}`
}
