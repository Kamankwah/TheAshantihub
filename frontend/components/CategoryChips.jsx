import { useState } from 'react'
import { C, tint } from '../theme.js'

// Multi-select category chips. `value` is the ordered selection: the first id is the main category (tagged "Main"),
// and picking appends, so the order is the order the owner chose. Colours come only from the theme tokens in `C`.
export function CategoryChips({ categories = [], value = [], onChange, max = 10, disabled = false, label }) {
  // Only ids that are still options count (a kind change can leave stale ids), each once, in pick order.
  const selected = []
  for (const id of Array.isArray(value) ? value : []) {
    if (!selected.includes(id) && categories.some((c) => c.id === id)) selected.push(id)
  }
  const atLimit = selected.length >= max
  const [showLimit, setShowLimit] = useState(false)

  const toggle = (id) => {
    if (disabled) return
    if (selected.includes(id)) {
      setShowLimit(false)
      onChange?.(selected.filter((x) => x !== id))
      return
    }
    if (atLimit) {
      setShowLimit(true)
      return
    }
    onChange?.([...selected, id])
  }

  return (
    <div role="group" aria-label={label} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {label ? <span style={{ fontSize: 13, fontWeight: 600, color: C.ink }}>{label}</span> : null}
      {categories.length > 0 ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {categories.map((cat) => {
            const on = selected.includes(cat.id)
            const isMain = on && selected[0] === cat.id
            return (
              <button
                key={cat.id}
                type="button"
                aria-pressed={on}
                disabled={disabled}
                onClick={() => toggle(cat.id)}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 44, padding: '6px 12px',
                  borderRadius: 999, fontSize: 13, fontWeight: on ? 600 : 500, fontFamily: 'inherit', lineHeight: 1.2,
                  cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.6 : 1,
                  color: C.ink,
                  background: on ? tint(C.gold, '33') : C.surface,
                  border: `1px solid ${on ? C.gold : C.line}`,
                }}
              >
                {cat.icon ? <span aria-hidden="true">{cat.icon}</span> : null}
                <span>{cat.label}</span>
                {isMain ? (
                  <span
                    style={{
                      fontSize: 10, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase',
                      padding: '1px 6px', borderRadius: 999, background: C.gold, color: C.darkBrown,
                    }}
                  >
                    Main
                  </span>
                ) : null}
              </button>
            )
          })}
        </div>
      ) : null}
      <div role="status" style={{ fontSize: 12, color: C.inkDim }}>
        {showLimit && atLimit ? `You can choose up to ${max}` : null}
      </div>
    </div>
  )
}

export default CategoryChips
