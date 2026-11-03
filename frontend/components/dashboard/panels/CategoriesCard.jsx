import { useState } from "react";
import { apiPut } from "../../../apiClient.js";
import { useCategories } from "../../../hooks/useCategories.js";
import { useMyCategories } from "../../../hooks/useMyCategories.js";
import { apiErrorMessage } from "../../../lib/apiErrorMessage.js";
import CategoryChips from "../../CategoryChips.jsx";
import { D, glassCard } from "../theme.js";

// "Your categories" (Profile & Settings): what the business sells or does, with the first as its main category.
// Works at any time, including after KYC approval (it never touches KYC, identity, subscription or listings).
// GET/PUT /api/accounts/business-owners/me/categories/ {categories: [ids]}; the options are the public categories of the
// business's own kind, so the other kind is never offered. Mutation = plain apiPut in try/catch, local actionError, then
// refetch (frontend convention; no useMutation). `picks` is null until the owner edits, so the chips follow the server.

const btn = (disabled) => ({ border: "none", borderRadius: 20, padding: "8px 16px", fontSize: "0.74rem", fontWeight: 800, cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.55 : 1, background: D.gold, color: D.darkBrown, fontFamily: "inherit" });
const linkBtn = { border: `1px solid ${D.cardBorder}`, borderRadius: 20, padding: "4px 12px", fontSize: "0.72rem", fontWeight: 700, cursor: "pointer", background: "transparent", color: D.text, fontFamily: "inherit" };

function Shell({ children }) {
  return (
    <div style={{ ...glassCard, padding: "20px 22px" }}>
      <div style={{ fontWeight: 800, color: D.text, fontSize: "0.88rem", marginBottom: 6 }}>Your categories</div>
      {children}
    </div>
  );
}

const sameOrder = (a, b) => a.length === b.length && a.every((id, i) => id === b[i]);

export default function CategoriesCard() {
  const mine = useMyCategories();
  const all = useCategories();
  const [picks, setPicks] = useState(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [actionError, setActionError] = useState(null);

  if (mine.isLoading || (mine.data?.business_kind && all.isLoading)) return <Shell><div style={{ color: D.textDim, fontSize: "0.82rem" }}>Loading your categories…</div></Shell>;
  if (mine.isError || !mine.data || all.isError) return <Shell><div role="alert" style={{ color: D.red, fontSize: "0.82rem" }}>Could not load your categories.</div></Shell>;

  const { business_kind: kind, max } = mine.data;
  if (!kind) {
    return <Shell><div style={{ color: D.textDim, fontSize: "0.82rem" }}>Choose products or services first.</div></Shell>;
  }

  const options = (all.data || []).filter((c) => c.kind === kind);
  if (options.length === 0) {
    return <Shell><div style={{ color: D.textDim, fontSize: "0.82rem" }}>There are no categories to choose from for your kind of business yet.</div></Shell>;
  }

  const serverIds = (mine.data.categories || []).map((c) => c.id);
  const optionIds = new Set(options.map((c) => c.id));
  const current = (picks ?? serverIds).filter((id) => optionIds.has(id));
  const dirty = !sameOrder(current, serverIds);
  const canSave = dirty && current.length >= 1 && !busy;
  const labelOf = (id) => options.find((c) => c.id === id)?.label || "";

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
      await apiPut("/api/accounts/business-owners/me/categories/", { categories: current });
      await mine.refetch();
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
      <CategoryChips categories={options} value={current} onChange={edit} max={max || 10} disabled={busy} label="Categories" />
      {current.length > 1 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
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
