import { useEffect, useRef, useState } from "react";
import { C } from "../../theme.js";
import { D } from "../dashboard/theme.js";
import { useCategoryTree } from "../../hooks/useCategoryTree.js";
import { MIN_SEARCH, SEARCH_GROUPS, cedis, useStorefrontSearch } from "../../hooks/useStorefront.js";
import { BODY_FONT, TABULAR } from "./storefrontType.js";

// The header search: a department <select> on the left (the shopper tree's
// top-level nodes, so only departments with something in them), the field,
// and the gold search button. Typing asks GET /api/storefront/search/ 300 ms
// after the last keystroke (2+ characters) and lists the answer grouped as
// Products, Services, Stays and Events; a group with nothing in it is left
// out, and an answer with nothing at all says so. Picking a row hands it to
// `onOpenResult(row)`; submitting hands `{q, category}` to `onSubmit`.
const DEBOUNCE_MS = 300;

export default function SearchBar({ onOpenResult, onSubmit }) {
  const { data: tree } = useCategoryTree();
  const departments = Array.isArray(tree) ? tree : [];
  const [text, setText] = useState("");
  const [term, setTerm] = useState("");
  const [category, setCategory] = useState("");
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);

  useEffect(() => {
    const id = setTimeout(() => setTerm(text.trim()), DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [text]);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const search = useStorefrontSearch(term, category);
  const showResults = open && term.length >= MIN_SEARCH && text.trim().length >= MIN_SEARCH;
  const groups = SEARCH_GROUPS.map((g) => ({ ...g, rows: search.data?.[g.key] || [] })).filter((g) => g.rows.length > 0);

  const submit = (e) => {
    e.preventDefault();
    const q = text.trim();
    if (!q) return;
    setOpen(false);
    onSubmit({ q, category });
  };
  const pick = (row) => {
    setOpen(false);
    onOpenResult(row);
  };

  return (
    <div ref={boxRef} style={{ position: "relative", width: "100%", minWidth: 0, fontFamily: BODY_FONT }}>
      <form role="search" aria-label="Site search" onSubmit={submit} style={{ display: "flex", height: 44, borderRadius: 10, overflow: "hidden", background: C.surface, boxShadow: `0 0 0 1px ${C.gold}33` }}>
        <select
          aria-label="Search in"
          value={category}
          onChange={(e) => { setCategory(e.target.value); setOpen(true); }}
          className="ah-search-picker"
          style={{ flex: "0 0 auto", maxWidth: 150, border: "none", borderRight: `1px solid ${C.gold}40`, background: D.panelBg2, color: C.ink, fontFamily: BODY_FONT, fontSize: 13, fontWeight: 600, padding: "0 8px", cursor: "pointer" }}
        >
          <option value="" style={{ color: C.ink, background: C.surface }}>All</option>
          {departments.map((d) => (
            <option key={d.id} value={d.slug} style={{ color: C.ink, background: C.surface }}>{d.label}</option>
          ))}
        </select>
        <input
          type="search"
          aria-label="Search AshantiHub"
          placeholder="Search AshantiHub"
          value={text}
          onChange={(e) => { setText(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }}
          autoComplete="off"
          style={{ flex: 1, minWidth: 0, border: "none", outline: "none", padding: "0 12px", fontFamily: BODY_FONT, fontSize: 15, color: C.ink, background: C.surface }}
        />
        <button type="submit" aria-label="Search" style={{ flex: "0 0 52px", border: "none", background: C.gold, color: C.darkBrown, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
        </button>
      </form>

      {showResults && (
        <div role="region" aria-label="Search results" style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, right: 0, zIndex: 300, background: C.surface, color: C.ink, borderRadius: 12, boxShadow: D.shadow, border: `1px solid ${C.gold}33`, maxHeight: "70vh", overflowY: "auto", padding: "6px 0" }}>
          {search.isPending ? (
            <p style={{ margin: 0, padding: "12px 16px", fontSize: 14, color: C.inkDim }}>Searching…</p>
          ) : search.isError ? (
            <p style={{ margin: 0, padding: "12px 16px", fontSize: 14, color: C.inkDim }}>Search is not answering right now. Try again in a moment.</p>
          ) : groups.length === 0 ? (
            <p style={{ margin: 0, padding: "12px 16px", fontSize: 14, color: C.inkDim }}>Nothing found for “{term}”.</p>
          ) : (
            groups.map((g) => (
              <div key={g.key} style={{ padding: "4px 0" }}>
                <div style={{ padding: "6px 16px 4px", fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: C.deepGold }}>{g.label}</div>
                {g.rows.map((row) => (
                  <button
                    key={`${g.key}-${row.id}`}
                    type="button"
                    onClick={() => pick(row)}
                    className="ah-search-row"
                    style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "8px 16px", border: "none", background: "transparent", textAlign: "left", cursor: "pointer", fontFamily: BODY_FONT, color: C.ink }}
                  >
                    {row.photo
                      ? <img src={row.photo} alt="" style={{ width: 36, height: 36, borderRadius: 8, objectFit: "cover", flexShrink: 0 }} />
                      : <span aria-hidden="true" style={{ width: 36, height: 36, borderRadius: 8, background: D.panelBg2, flexShrink: 0 }} />}
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: "block", fontSize: 14, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.name}</span>
                      {row.category_label && <span style={{ display: "block", fontSize: 12, color: C.inkDim }}>{row.category_label}</span>}
                    </span>
                    {cedis(row.price) && (
                      <span style={{ fontSize: 13, fontWeight: 700, color: C.ink, whiteSpace: "nowrap", ...TABULAR }}>
                        {g.key === "events" ? `from ${cedis(row.price)}` : cedis(row.price)}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            ))
          )}
          <style>{`.ah-search-row:hover, .ah-search-row:focus-visible { background: ${D.panelBg2} !important; outline: none; }`}</style>
        </div>
      )}
    </div>
  );
}
