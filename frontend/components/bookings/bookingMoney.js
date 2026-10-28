import { formatAccra, refundLines } from '../../lib/bookingTerms.js'

// Copy for a customer's booking money states. Every amount and time is the server's (the `money` block); nothing
// here works out a refund or a release time.

const PAYEE = { service: 'business', stay: 'host', tickets: 'organiser' }

export const payeeWord = (kind) => PAYEE[kind]

const at = (iso) => formatAccra(new Date(iso))

// The refund sentence, or null when nothing was refunded. Only the server's amount is shown.
export function refundLine(money) {
  if (!money?.refunded) return null
  return money.refunded_whole
    ? `Refunded in full: GH₵ ${money.refunded} went back to your AshantiHub wallet.`
    : `GH₵ ${money.refunded} went back to your AshantiHub wallet.`
}

// Amount lines use the price token, every other line the body text colour (DESIGN.md trust surfaces).
export const lineColor = (text, D) => (text.includes('GH₵') ? D.price : D.text)

export function moneyLines(money, kind, now = new Date()) {
  if (!money) return []
  const P = payeeWord(kind)
  const lines = []
  const refund = refundLine(money)
  if (refund) lines.push(refund)
  if (money.problem === 'open') {
    lines.push(`Problem reported. Support is looking into it, and the payment to the ${P} is on hold until it is settled.`)
    return lines
  }
  if (money.problem === 'closed') lines.push('Support has settled the problem you reported.')
  if (money.released_at && money.accepted_at) {
    lines.push(`You accepted this on ${at(money.accepted_at)}. The business has been paid.`)
  } else if (money.released_at) {
    lines.push(`The ${P} was paid on ${at(money.released_at)}.`)
  } else if (money.refunded && !money.refunded_whole && money.cancelled_by_you) {
    lines.push(`The ${P} keeps the rest under the cancellation policy.`)
  } else if (money.release_at && new Date(money.release_at) <= now) {
    lines.push(`The ${P} is due to be paid now.`)
  } else if (money.release_at) {
    // Once Report is gone (Support closed the problem, or the server does not offer it) the line must not invite one.
    const canReport = money.problem !== 'closed' && money.can_report !== false
    if (kind === 'service') lines.push(`Accepts automatically on ${at(money.release_at)}${canReport ? ' unless you report a problem' : ''}.`)
    else lines.push(`The ${P} is paid on ${at(money.release_at)}${canReport ? ' unless you report a problem before then' : ''}.`)
  }
  return lines
}

export function policyLines(money, now = new Date()) {
  const policy = money?.policy
  if (!policy) return []
  if (!money.start) return ['Full refund any time before the business marks the job done']
  if (!policy.tiers?.length) return []
  return refundLines(policy.tiers, new Date(money.start), now)
}

export const policyLabel = (policy, terms) => terms?.policies?.[policy?.policy]?.label ?? null

export function groupTicketsByPurchase(tickets) {
  const groups = []
  const bySale = new Map()
  for (const ticket of tickets || []) {
    const sale = ticket.money?.sale
    if (sale == null) {
      groups.push({ key: `ticket-${ticket.id}`, money: ticket.money ?? null, tickets: [ticket] })
    } else if (bySale.has(sale)) {
      bySale.get(sale).tickets.push(ticket)
    } else {
      const group = { key: `sale-${sale}`, money: ticket.money, tickets: [ticket] }
      bySale.set(sale, group)
      groups.push(group)
    }
  }
  return groups
}
