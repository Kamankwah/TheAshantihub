// A phone as scout screens show it: "024 *** 118" (the canvas). The number
// itself stays in the tel: link; this is only what is drawn. It reads the last
// 9 digits, so 0241234118, +233241234118, 233241234118 and legacy forms such as
// 00233241234118 or 241234118 all mask the same; anything shorter is returned untouched.
export function maskPhone(value) {
  if (!value) return ''
  const digits = String(value).replace(/[^\d]/g, '')
  if (digits.length < 9 || digits.length > 14) return String(value)
  const local = `0${digits.slice(-9)}`
  return `${local.slice(0, 3)} *** ${local.slice(-3)}`
}
