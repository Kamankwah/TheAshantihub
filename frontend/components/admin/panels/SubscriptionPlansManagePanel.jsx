import { useState } from "react";
import { apiPost, apiPatch } from "../../../apiClient.js";
import { useSubscriptionPlansManageQueue } from "../../../hooks/useSubscriptionPlansManageQueue.js";
import { D, glassCard, SUBSCRIPTION_PLAN_STATUS_META } from "../theme.js";

const EMPTY_SUBSCRIPTION_PLAN_FORM = {
  tier: "", name: "", kind: "product", monthly_price: "",
  max_active_listings: "", hero_days: "", boost_credits_per_month: "",
  is_recommended: false, features: "",
};

// features is edited as a plain one-bullet-per-line textarea and converted to
// a JSON array on submit; max_active_listings left blank means unlimited
// (null), matching the backend contract.
function subscriptionPlanFormToPayload(form) {
  return {
    tier: form.tier.trim(),
    name: form.name.trim(),
    kind: form.kind,
    monthly_price: form.monthly_price,
    max_active_listings: form.max_active_listings === "" ? null : Number(form.max_active_listings),
    hero_days: form.hero_days === "" ? 0 : Number(form.hero_days),
    boost_credits_per_month: form.boost_credits_per_month === "" ? 0 : Number(form.boost_credits_per_month),
    is_recommended: form.is_recommended,
    features: form.features.split("\n").map(s => s.trim()).filter(Boolean),
  };
}

function subscriptionPlanToForm(plan) {
  return {
    tier: plan.tier || "",
    name: plan.name || "",
    kind: plan.kind || "product",
    monthly_price: plan.monthly_price ?? "",
    max_active_listings: plan.max_active_listings == null ? "" : String(plan.max_active_listings),
    hero_days: plan.hero_days ?? "",
    boost_credits_per_month: plan.boost_credits_per_month ?? "",
    is_recommended: !!plan.is_recommended,
    features: (plan.features || []).join("\n"),
  };
}

// Shared field set for both the "create new plan" form and each plan's
// inline "Edit" reveal below — same "generic field list drives the form"
// convention as SiteSettingsForm's SITE_SETTINGS_FIELDS, just not
// table-driven since these fields have mixed input types.
function SubscriptionPlanFormFields({ form, setField }) {
  const fieldStyle = { padding: "6px 10px", borderRadius: 10, border: `1.5px solid ${D.cardBorder}`, fontSize: "0.75rem", fontFamily: "inherit", background: D.panelBg2, color: D.text };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <input value={form.tier} onChange={e => setField("tier", e.target.value)} placeholder="Tier slug (e.g. product_basic)" style={{ ...fieldStyle, flex: 1, minWidth: 160 }} />
        <input value={form.name} onChange={e => setField("name", e.target.value)} placeholder="Plan name" style={{ ...fieldStyle, flex: 1, minWidth: 140 }} />
        <select value={form.kind} onChange={e => setField("kind", e.target.value)} style={{ ...fieldStyle, width: 120 }}>
          <option value="product">Product</option>
          <option value="service">Service</option>
        </select>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <input type="number" min={0} step="0.01" value={form.monthly_price} onChange={e => setField("monthly_price", e.target.value)} placeholder="Monthly price (GHS)" style={{ ...fieldStyle, flex: 1, minWidth: 120 }} />
        <input type="number" min={0} value={form.max_active_listings} onChange={e => setField("max_active_listings", e.target.value)} placeholder="Max active listings (blank = unlimited)" style={{ ...fieldStyle, flex: 1, minWidth: 190 }} />
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <input type="number" min={0} value={form.hero_days} onChange={e => setField("hero_days", e.target.value)} placeholder="Hero days" style={{ ...fieldStyle, flex: 1, minWidth: 100 }} />
        <input type="number" min={0} value={form.boost_credits_per_month} onChange={e => setField("boost_credits_per_month", e.target.value)} placeholder="Boost credits / month" style={{ ...fieldStyle, flex: 1, minWidth: 150 }} />
      </div>
      <label style={{ display: "flex", alignItems: "center", gap: 6, color: D.textDim, fontSize: "0.75rem" }}>
        <input type="checkbox" checked={form.is_recommended} onChange={e => setField("is_recommended", e.target.checked)} /> Recommended plan
      </label>
      <textarea value={form.features} onChange={e => setField("features", e.target.value)} placeholder="Features, one per line" rows={3} style={{ ...fieldStyle, resize: "vertical" }} />
    </div>
  );
}

// Staff "subscription_plans.manage" panel (accountant + super_admin): create
// new plans and edit any existing plan regardless of status. Clones
// CategoriesZonesPanel's create-form + local actionError/refetch()
// convention, plus HeroApprovalPanel's per-row inline-reveal shape for edit.
// A plan the server resets to "pending_approval" on edit (per the backend
// contract) is just reflected via the status badge below — no special
// handling needed here.
export default function SubscriptionPlansManagePanel() {
  const { data, isLoading, isError, refetch } = useSubscriptionPlansManageQueue();
  const [createForm, setCreateForm] = useState(EMPTY_SUBSCRIPTION_PLAN_FORM);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState(null);

  const setCreateField = (key, value) => setCreateForm(f => ({ ...f, [key]: value }));
  const setEditFieldValue = (key, value) => setEditForm(f => ({ ...f, [key]: value }));

  const createPlan = async () => {
    setActionError(null);
    setCreating(true);
    try {
      await apiPost("/api/billing/plans/manage/", subscriptionPlanFormToPayload(createForm));
      setCreateForm(EMPTY_SUBSCRIPTION_PLAN_FORM);
      refetch();
    } catch (err) {
      setActionError("Could not create this plan. Check the fields and try again.");
    } finally {
      setCreating(false);
    }
  };

  const startEdit = (plan) => {
    setActionError(null);
    setEditingId(plan.id);
    setEditForm(subscriptionPlanToForm(plan));
  };

  const saveEdit = async () => {
    if (!editingId || !editForm) return;
    setActionError(null);
    setSaving(true);
    try {
      await apiPatch(`/api/billing/plans/manage/${editingId}/`, subscriptionPlanFormToPayload(editForm));
      setEditingId(null);
      setEditForm(null);
      refetch();
    } catch (err) {
      setActionError("Could not save this plan. Check the fields and try again.");
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) return <div style={{ color: D.textDim, fontSize: "0.8rem" }}>Loading…</div>;
  if (isError) return <div style={{ color: D.red, fontSize: "0.8rem" }}>Could not load subscription plans.</div>;
  const items = data || [];

  return (
    <div>
      {actionError && <div style={{ color: D.red, fontSize: "0.8rem", marginBottom: 10 }}>{actionError}</div>}
      <div style={{ ...glassCard, padding: 18, marginBottom: 16, maxWidth: 560 }}>
        <div style={{ color: D.text, fontWeight: 800, fontSize: "0.88rem", marginBottom: 12 }}>Create a new plan</div>
        <SubscriptionPlanFormFields form={createForm} setField={setCreateField} />
        <button onClick={createPlan} disabled={creating || !createForm.tier || !createForm.name} style={{ marginTop: 12, background: D.gold, color: "#1a1205", border: "none", borderRadius: 20, padding: "8px 20px", fontSize: "0.78rem", fontWeight: 800, cursor: creating ? "default" : "pointer", fontFamily: "inherit" }}>{creating ? "Creating…" : "Create plan"}</button>
      </div>

      <div style={{ ...glassCard, padding: 18 }}>
        <div style={{ color: D.text, fontWeight: 800, fontSize: "0.88rem", marginBottom: 14 }}>All plans ({items.length})</div>
        {items.length === 0 && <div style={{ color: D.textDim, fontSize: "0.8rem" }}>No plans yet.</div>}
        {items.map(p => {
          const statusMeta = SUBSCRIPTION_PLAN_STATUS_META[p.status] || { label: p.status, color: D.textDim };
          return (
            <div key={p.id} style={{ padding: "12px 0", borderBottom: `1px solid ${D.divider}` }}>
              {editingId === p.id ? (
                <div>
                  <SubscriptionPlanFormFields form={editForm} setField={setEditFieldValue} />
                  <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                    <button onClick={saveEdit} disabled={saving} style={{ background: D.gold, color: "#1a1205", border: "none", borderRadius: 20, padding: "6px 16px", fontSize: "0.75rem", fontWeight: 800, cursor: saving ? "default" : "pointer", fontFamily: "inherit" }}>{saving ? "Saving…" : "Save"}</button>
                    <button onClick={() => { setEditingId(null); setEditForm(null); }} style={{ background: "none", border: `1px solid ${D.cardBorder}`, color: D.textDim, borderRadius: 20, padding: "6px 16px", fontSize: "0.75rem", cursor: "pointer", fontFamily: "inherit" }}>Cancel</button>
                  </div>
                </div>
              ) : (
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
                  <div>
                    <div style={{ color: D.text, fontWeight: 700, fontSize: "0.82rem" }}>
                      {p.name} <span style={{ color: D.textDim, fontWeight: 400 }}>({p.tier})</span>
                      {p.is_recommended && <span style={{ background: `${D.gold}33`, color: D.gold, borderRadius: 20, padding: "2px 8px", fontSize: "0.6rem", fontWeight: 700, marginLeft: 6 }}>★ Recommended</span>}
                      <span style={{ background: `${statusMeta.color}22`, color: statusMeta.color, borderRadius: 20, padding: "2px 8px", fontSize: "0.6rem", fontWeight: 700, marginLeft: 6 }}>{statusMeta.label}</span>
                    </div>
                    <div style={{ color: D.textDim, fontSize: "0.72rem", margin: "3px 0" }}>{p.kind === "product" ? "Product" : "Service"} · GHS {p.monthly_price}/mo · Max listings: {p.max_active_listings ?? "Unlimited"} · Hero days: {p.hero_days} · Boost credits: {p.boost_credits_per_month}</div>
                    {p.status === "rejected" && p.rejection_reason && <div style={{ color: D.red, fontSize: "0.68rem", marginTop: 2 }}>Rejected: {p.rejection_reason}</div>}
                  </div>
                  <button onClick={() => startEdit(p)} style={{ background: "none", border: `1px solid ${D.cardBorder}`, color: D.text, borderRadius: 20, padding: "5px 14px", fontSize: "0.7rem", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>✏️ Edit</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
