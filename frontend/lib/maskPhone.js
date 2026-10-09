// A phone as scout screens show it: "024 *** 118" (the canvas). The number
// itself stays in the tel: link; this is only what is drawn. Accepts 0241234118,
// +233241234118 and 233241234118; anything it can't read is returned untouched.
export function maskPhone(value) {
  if (!value) return ''
  let digits = String(value).replace(/[^\d]/g, '')
  if (digits.startsWith('233') && digits.length === 12) digits = `0${digits.slice(3)}`
  if (digits.length !== 10 || !digits.startsWith('0')) return String(value)
  return `${digits.slice(0, 3)} *** ${digits.slice(-3)}`
}
