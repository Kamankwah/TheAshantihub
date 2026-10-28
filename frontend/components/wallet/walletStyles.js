import { C } from '../../theme.js'
import { D } from '../dashboard/theme.js'

// Inline styles for the wallet screens. tone "light" = customer surfaces (C),
// "dashboard" = business and staff surfaces (D). Theme tokens only. Amounts
// are the dark-brown price ink in tabular figures and never gold; the only
// gold is the single confirm button.
export function walletStyles(tone = 'light') {
  const dash = tone === 'dashboard'
  const t = dash
    ? { surface: D.panelBg, well: D.panelBg2, border: D.cardBorder, text: D.text, dim: D.textDim, price: D.price, err: D.errInk, errBg: D.errBg, gold: D.gold, onGold: D.darkBrown }
    : { surface: C.surface, well: C.surface2, border: C.border, text: C.ink, dim: C.inkDim, price: C.price, err: C.errInk, errBg: C.errBg, gold: C.gold, onGold: C.darkBrown }
  return {
    card: { background: t.surface, border: `1px solid ${t.border}`, borderRadius: 12, padding: 20, color: t.text },
    label: { display: 'block', fontSize: 13, fontWeight: 600, color: t.dim, marginBottom: 6 },
    value: { fontSize: 15, color: t.text },
    amount: { fontVariantNumeric: 'tabular-nums', color: t.price, fontWeight: 700 },
    button: {
      background: t.gold, color: t.onGold, border: 'none', borderRadius: 8, padding: '12px 20px',
      fontSize: 15, fontWeight: 700, cursor: 'pointer', minHeight: 44,
    },
    ghost: {
      background: 'transparent', color: t.text, border: `1px solid ${t.border}`, borderRadius: 8, padding: '10px 16px',
      fontSize: 14, fontWeight: 600, cursor: 'pointer', minHeight: 44,
    },
    field: {
      width: '100%', boxSizing: 'border-box', background: t.well, color: t.text, border: `1px solid ${t.border}`,
      borderRadius: 8, padding: '10px 12px', fontSize: 16, minHeight: 44,
    },
    error: { background: t.errBg, color: t.err, borderRadius: 8, padding: '10px 12px', fontSize: 14 },
    note: { fontSize: 13, color: t.dim, lineHeight: 1.5 },
  }
}
