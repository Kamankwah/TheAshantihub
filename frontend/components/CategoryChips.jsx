import { useId, useState } from 'react'
import { C, tint } from '../theme.js'
import { categoryOptionGroups, categoryPathLabeler } from '../lib/categoryOptions.jsx'

// Past this many options a search box appears.
const SEARCH_AFTER = 24

// Multi-select category chips. `value` is the ordered selection: the first id is the main category (tagged "Main"),
// and picking appends, so the order is the order the owner chose. Colours come only from the theme tokens in `C`.
//
// A short flat list (service categories) is one row of chips. The product list is a department tree of ~270 rows
// whose sub-category labels repeat across departments ("Accessories" under five of them, ruling R34), so when the
// options carry a `parent` the chips sit in one collapsible section per department (`categoryOptionGroups`; `all`,
// the full category list, finds a department a filtered list left out). A section starts open only when it holds a
// pick; while the search box has text every matching section is open. Inside a section a chip shows its short label
// (the heading says which department); outside it, a pick is named by its path ("Clothing › Accessories").
export function CategoryChips({ categories = [], value = [], onChange, max = 10, disabled = false, label, all }) {
  // Only ids that are still options count (a kind change can leave stale ids), each once, in pick order.
  const selected = []
  for (const id of Array.isArray(value) ? value : []) {
    if (!selected.includes(id) && categories.some((c) => c.id === id)) selected.push(id)
  }
  const atLimit = selected.length >= max
  const [showLimit, setShowLimit] = useState(false)
  const [query, setQuery] = useState('')
  // The owner's own open/closed choice per section; while searching, a separate one that a new search clears.
  const [opened, setOpened] = useState({})
  const [openedInSearch, setOpenedInSearch] = useState({})
  const baseId = useId()

  const lookup = all || categories
  const pathOf = categoryPathLabeler(lookup)
  const byId = new Map(categories.map((c) => [c.id, c]))
  const grouped = categories.some((c) => c.parent != null)
  const searchable = categories.length > SEARCH_AFTER
  const needle = searchable ? query.trim().toLowerCase() : ''
  const matches = (cat, shown) => !needle
    || [cat.label, shown, pathOf(cat)].some((text) => String(text || '').toLowerCase().includes(needle))

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

  // In a section the heading carries the department's icon, so its chips go without one.
  const chip = (cat, text, onPick, withIcon = true) => {
    const on = selected.includes(cat.id)
    const isMain = on && selected[0] === cat.id
    return (
      <button
        key={cat.id}
        type="button"
        aria-pressed={on}
        disabled={disabled}
        onClick={() => { onPick?.(); toggle(cat.id) }}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 44, padding: '6px 12px',
          borderRadius: 999, fontSize: 13, fontWeight: on ? 600 : 500, fontFamily: 'inherit', lineHeight: 1.2,
          cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.6 : 1,
          color: C.ink,
          background: on ? tint(C.gold, '33') : C.surface,
          border: `1px solid ${on ? C.gold : C.line}`,
        }}
      >
        {withIcon && cat.icon ? <span aria-hidden="true">{cat.icon}</span> : null}
        <span>{text}</span>
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
  }

  const row = { display: 'flex', flexWrap: 'wrap', gap: 8 }
  const noMatch = needle ? (
    <div style={{ fontSize: 13, color: C.inkDim }}>{`No categories match “${query.trim()}”.`}</div>
  ) : null

  let body = null
  if (categories.length > 0 && !grouped) {
    const shown = categories.filter((cat) => matches(cat, cat.label))
    body = shown.length > 0 ? <div style={row}>{shown.map((cat) => chip(cat, cat.label))}</div> : noMatch
  } else if (categories.length > 0) {
    const sections = categoryOptionGroups(categories, lookup)
      .map((group) => ({ ...group, shown: group.options.filter((o) => matches(byId.get(o.id), o.label)) }))
      .filter((group) => group.shown.length > 0)
    // A pick keeps its section open, so unpicking the last one there does not fold it away under the pointer.
    const keepOpen = (key) => setOpened((prev) => (prev[key] ? prev : { ...prev, [key]: true }))
    body = sections.length === 0 ? noMatch : (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {sections.map((group) => {
          const count = group.options.filter((o) => selected.includes(o.id)).length
          const open = needle ? (openedInSearch[group.key] ?? true) : (opened[group.key] ?? count > 0)
          const panelId = `${baseId}-${group.key}`
          const flip = () => (needle ? setOpenedInSearch : setOpened)((prev) => ({ ...prev, [group.key]: !open }))
          return (
            <div key={group.key}>
              <button
                type="button"
                aria-expanded={open}
                aria-controls={open ? panelId : undefined}
                onClick={flip}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, width: '100%', minHeight: 44, padding: '8px 12px',
                  boxSizing: 'border-box', borderRadius: 10, border: `1px solid ${C.line}`,
                  background: open ? C.surface2 : C.surface, color: C.ink, fontFamily: 'inherit', fontSize: 13,
                  fontWeight: 600, textAlign: 'left', cursor: 'pointer',
                }}
              >
                <span aria-hidden="true" style={{ width: 12, color: C.inkDim }}>{open ? '▾' : '▸'}</span>
                <span style={{ flex: 1 }}>{group.label}</span>
                {count > 0 ? (
                  <span
                    style={{
                      fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999,
                      background: tint(C.gold, '33'), color: C.ink, whiteSpace: 'nowrap',
                    }}
                  >
                    {`${count} selected`}
                  </span>
                ) : null}
              </button>
              {open ? (
                <div id={panelId} role="group" aria-label={group.label} style={{ ...row, padding: '8px 0 4px' }}>
                  {group.shown.map((o) => chip(byId.get(o.id), o.label, () => keepOpen(group.key), false))}
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <div role="group" aria-label={label} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {label ? <span style={{ fontSize: 13, fontWeight: 600, color: C.ink }}>{label}</span> : null}
      {searchable ? (
        <input
          type="search"
          aria-label="Search categories"
          placeholder="Search categories"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpenedInSearch({}) }}
          style={{
            width: '100%', boxSizing: 'border-box', minHeight: 44, padding: '8px 12px', borderRadius: 10,
            border: `1px solid ${C.line}`, background: C.surface, color: C.ink, fontFamily: 'inherit', fontSize: 16,
          }}
        />
      ) : null}
      {body}
      {grouped && selected.length > 0 ? (
        <div style={{ fontSize: 12, color: C.ink, lineHeight: 1.45 }}>
          {`Selected: ${selected.map((id, i) => `${pathOf(byId.get(id))}${i === 0 ? ' (main)' : ''}`).join(' · ')}`}
        </div>
      ) : null}
      <div role="status" style={{ fontSize: 12, color: C.inkDim }}>
        {showLimit && atLimit ? `You can choose up to ${max}` : null}
      </div>
    </div>
  )
}

export default CategoryChips
