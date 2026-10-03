// A Conversation.subject is stored as a "Re: <business or listing>" context
// line (the client sends it with the prefix), but older/other rows may hold the
// bare name. Render exactly one "Re:" either way.
export function subjectLine(subject) {
  const s = (subject || '').trim()
  if (!s) return ''
  return /^re:/i.test(s) ? s : `Re: ${s}`
}
