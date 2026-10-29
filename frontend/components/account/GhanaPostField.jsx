import { useId } from 'react'
import { formatGhanaPostInput } from '../../lib/ghanaPost.js'
import { walletStyles } from '../wallet/walletStyles.js'

// The GhanaPost digital-address input: hyphens go in as the shopper types
// (AK039 -> AK-039-). `error` is shown inline under the field, verbatim.
export default function GhanaPostField({ value, onChange, error, label = 'Ghana Post GPS address' }) {
  const s = walletStyles('light')
  const id = useId()
  const hint = `${id}-hint`
  const err = `${id}-err`
  return (
    <div>
      <label htmlFor={id} style={s.label}>{label}</label>
      <input
        id={id}
        type="text"
        inputMode="text"
        autoCapitalize="characters"
        autoComplete="off"
        spellCheck={false}
        placeholder="AK-039-5028"
        value={value}
        maxLength={12}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${hint} ${err}` : hint}
        onChange={(e) => onChange(formatGhanaPostInput(e.target.value, { deleting: e.target.value.length < value.length }))}
        style={{ ...s.field, fontFamily: 'var(--font-mono, "JetBrains Mono", monospace)', letterSpacing: 1 }}
      />
      <div id={hint} style={{ ...s.note, marginTop: 4 }}>Find yours in the GhanaPost GPS app</div>
      {error && <div id={err} role="alert" style={{ ...s.note, color: s.error.color, marginTop: 4 }}>{error}</div>}
    </div>
  )
}
