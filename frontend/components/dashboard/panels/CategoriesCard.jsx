import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiPut } from "../../../apiClient.js";
import { useCategories } from "../../../hooks/useCategories.js";
import { useMyCategories } from "../../../hooks/useMyCategories.js";
import { apiErrorMessage } from "../../../lib/apiErrorMessage.js";
import { categoryPathLabeler } from "../../../lib/categoryOptions.jsx";
import CategoryChips from "../../CategoryChips.jsx";
import { D, glassCard } from "../theme.js";

// "Your categories" (Profile & Settings): what the business sells or does, with the first as its main category.
// Works at any time, including after KYC approval (it never touches KYC, identity, subscription or listings).
// GET/PUT /api/accounts/business-owners/me/categories/ {categories: [ids]}; the options are the public categories of the
// business's own kind, so the other kind is never offered. Mutation = plain apiPut in try/catch with a local actionError
// (frontend convention; no useMutation); the PUT answers the saved list, which seeds the ['my-categories'] cache, so a
// later refetch failing cannot undo "Saved". `picks` is null until the owner edits, so the chips follow the server.
// A stored category the card cannot offer (no longer of the business's kind) is left out of the comparison, so the card
// does not look edited on load; a note says it goes on the next save.

const btn = (disabled) => ({ border: "none", borderRadius: 20, padding: "8px 16px", fontSize: "0.74rem", fontWeight: 800, cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.55 : 1, background: D.gold, color: D.darkBrown, fontFamily: "inherit" });
const linkBtn = { border: `1px solid ${D.cardBorder}`, borderRadius: 20, minHeight: 44, padding: "4px 14px", fontSize: "0.72rem", fontWeight: 700, cursor: "pointer", background: "transparent", color: D.text, fontFamily: "inherit" };

function Shell({ children }) {
  return (
    <div style={{ ...glassCard, padding: "20px 22px" }}>
      <div style={{ fontWeight: 800, color: D.text, fontSize: "0.88rem", marginBottom: 6 }}>Your categories</div>
      {children}
    </div>
  );
}

const sameOrder = (a, b) => a.length === b.length && a.every((id, i) => id === b[i]);

const loading = <Shell><div style={{ color: D.textDim, fontSize: "0.82rem" }}>Loading your categories…</div></Shell>;
const loadError = <Shell><div role="alert" style={{ color: D.red, fontSize: "0.82rem" }}>Could not load your categories.</div></Shell>;

export default function CategoriesCard() {
  const queryClient = useQueryClient();
  const mine = useMyCategories();
  const kind = mine.data?.business_kind;
  // The options are needed only once there is a kind; without one the public list is never asked for.
  const all = useCategories({ enabled: Boolean(kind) });
  const [picks, setPicks] = useState(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [actionError, setActionError] = useState(null);

  // Rendered from data whenever there is some: a background refetch that fails keeps what is on screen.
  if (!mine.data) return mine.isError ? loadError : loading;
  if (!kind) {
    return <Shell><div style={{ color: D.textDim, fontSize: "0.82rem" }}>Choose products or services first.</div></Shell>;
  }
  if (!all.data) return all.isError ? loadError : loading;
  const { max } = mine.data;

  const options = (all.data || []).filter((c) => c.kind === kind);
  if (options.length === 0) {
    return <Shell><div style={{ color: D.textDim, fontSize: "0.82rem" }}>There are no categories to choose from for your kind of business yet.</div></Shell>;
  }

  const optionIds = new Set(options.map((c) => c.id));
  const storedIds = (mine.data.categories || []).map((c) => c.id);
  // What the server holds that the card can show: compared against, so nothing looks edited on load.
  const serverIds = storedIds.filter((id) => optionIds.has(id));
  const leaving = storedIds.length - serverIds.length;
  const current = (picks ?? serverIds).filter((id) => optionIds.has(id));
  const dirty = !sameOrder(current, serverIds);
  const canSave = dirty && current.length >= 1 && !busy;
  const allRows = Array.isArray(all.data) ? all.data : [];
  const pathOf = categoryPathLabeler(allRows.length ? allRows : options);
  const labelOf = (id) => {
    const category = options.find((c) => c.id === id);
    return category ? pathOf(category) : "";
  };

  const edit = (ids) => {
    setPicks(ids);
    setSaved(false);
    setActionError(null);
  };

  const onSave = async () => {
    if (!canSave) return;
    setBusy(true);
    setActionError(null);
    setSaved(false);
    try {
      const fresh = await apiPut("/api/accounts/business-owners/me/categories/", { categories: current });
      if (Array.isArray(fresh?.categories)) {
        queryClient.setQueryData(["my-categories"], fresh);
      } else {
        mine.refetch(); // not awaited: the save already succeeded, a failed refetch must not hide it
      }
      setPicks(null);
      setSaved(true);
    } catch (err) {
      setActionError(apiErrorMessage(err, "Could not save your categories. Please try again."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell>
      <div style={{ color: D.textDim, fontSize: "0.78rem", marginBottom: 14 }}>
        These describe what you sell or do. You can still list in any category of your kind.
      </div>
      <CategoryChips categories={options} all={allRows} value={current} onChange={edit} max={max || 10} disabled={busy} label="Categories" />
      {leaving > 0 && (
        <div style={{ color: D.textDim, fontSize: "0.76rem", marginTop: 8 }}>
          {leaving === 1
            ? "1 category no longer applies to your business type and will be removed when you save."
            : `${leaving} categories no longer apply to your business type and will be removed when you save.`}
        </div>
      )}
      {current.length > 1 && (
        <div role="group" aria-label="Change the main category" style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
          {current.slice(1).map((id) => (
            <button key={id} type="button" disabled={busy} style={linkBtn} onClick={() => edit([id, ...current.filter((x) => x !== id)])}>
              Make {labelOf(id)} main
            </button>
          ))}
        </div>
      )}
      {actionError && <div role="alert" style={{ color: D.red, fontSize: "0.78rem", marginTop: 10 }}>{actionError}</div>}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 14 }}>
        <button type="button" style={btn(!canSave)} disabled={!canSave} onClick={onSave}>Save</button>
        {saved && !dirty && <span role="status" style={{ color: D.green, fontSize: "0.78rem", fontWeight: 700 }}>✓ Saved</span>}
      </div>
    </Shell>
  );
}
