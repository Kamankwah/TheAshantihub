// Labels for the marketplace opening, always formatted from the server's
// opens_at in Accra time (ruling R4: the date is never hardcoded, so a Super
// Admin delay changes every label at once).
const TZ = 'Africa/Accra'

const dayMonth = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: TZ })
const time = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: TZ })

// "Opens 6 Nov" — the text on every disabled buy action.
export function opensLabel(opensAt) {
  if (!(opensAt instanceof Date) || Number.isNaN(opensAt.getTime())) return 'Opens soon'
  return `Opens ${dayMonth.format(opensAt)}`
}

// "The marketplace opens 6 Nov, 06:00" — the countdown headline.
export function opensHeadline(opensAt) {
  if (!(opensAt instanceof Date) || Number.isNaN(opensAt.getTime())) return 'The marketplace opens soon'
  return `The marketplace opens ${dayMonth.format(opensAt)}, ${time.format(opensAt)}`
}

// Days / hours / minutes / seconds left in `ms`, each floored, never negative.
export function splitRemaining(ms) {
  const total = Math.max(0, Math.floor(ms / 1000))
  return {
    days: Math.floor(total / 86400),
    hours: Math.floor((total % 86400) / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
  }
}
