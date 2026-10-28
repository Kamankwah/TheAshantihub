import { useEffect, useState } from "react";
import { apiErrorMessage } from "../../../../lib/apiErrorMessage.js";
import { useCategories } from "../../../../hooks/useCategories.js";
import { CategoryOptions } from "../../../../lib/categoryOptions.jsx";
import { couponAction, createCoupon, deleteCoupon, updateCoupon, useCoupon } from "../../../../hooks/useMarketingPromos.js";
import { D } from "../../theme.js";
import { COUPON_STATUS, valueWord } from "./CouponsPanel.jsx";
import { OffNotice } from "./promoParts.jsx";
import { Honest, Loading, PageHead, Section, button, chip, dim, errorStyle, inputStyle, labelStyle, linkStyle, money, page } from "./mkParts.jsx";

// ─── 11 Coupon editor ────────────────────────────────────────────────────────
const day = (iso) => (iso ? iso.slice(0, 10) : "");
const BLANK = { code: "", code_mode: "shared", kind: "fixed", value: "", max_discount: "", min_spend: "0", usage_limit: 100, per_customer_limit: 1, starts_at: "", expires_at: "", category: "", budget_cap: "" };

export default function CouponEditor({ id, onBack, onOpenDetail }) {
  const isNew = id === "new";
  const { data, isError, refetch } = useCoupon(id);
  const categories = useCategories();
  const [form, setForm] = useState(isNew ? BLANK : null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (data && !isNew) setForm({ code: data.code, code_mode: data.code_mode, kind: data.kind, value: data.value, max_discount: data.max_discount || "", min_spend: data.min_spend, usage_limit: data.usage_limit, per_customer_limit: data.per_customer_limit, starts_at: day(data.starts_at), expires_at: day(data.expires_at), category: data.category || "", budget_cap: data.budget_cap });
  }, [data, isNew]);

  if (!form || (!isNew && !data)) return <div style={page}><PageHead crumb="Coupons" title="Coupon" /><Loading error={isError} onRetry={refetch} what="this coupon" /></div>;

  const editable = isNew || data.editable;
  const set = (patch) => { setNotice(""); setForm({ ...form, ...patch }); };
  const single = form.code_mode === "single_use";
  // The ceiling the server will use when no budget cap is typed: uses x the most one order can take off.
  const ceiling = form.kind === "fixed" ? Number(form.value) : Number(form.max_discount);
  const computedCap = form.budget_cap !== "" ? Number(form.budget_cap) : ceiling > 0 ? ceiling * Number(form.usage_limit || 0) : null;
  const threshold = Number(data?.threshold ?? 25);
  const needsApproval = computedCap != null && computedCap > threshold;
  const payload = () => ({ ...form, budget_cap: form.budget_cap === "" ? "" : form.budget_cap, category: form.category || null, per_customer_limit: single ? 1 : form.per_customer_limit });

  async function save(then) {
    setBusy(true); setActionError(""); setNotice("");
    try {
      const saved = isNew ? await createCoupon(payload()) : await updateCoupon(id, payload());
      if (then === "activate") {
        const done = await couponAction(saved.id, "activate");
        setNotice(done.status === "active" ? "The coupon is live (once checkout promotions are on)." : "Sent to Super Admin. No code works until it is approved.");
      } else setNotice("Draft saved.");
      if (isNew) onOpenDetail?.(String(saved.id)); else await refetch();
    } catch (error) { setActionError(apiErrorMessage(error, "Could not save the coupon.")); } finally { setBusy(false); }
  }
  async function act(action, done) {
    setBusy(true); setActionError("");
    try { await couponAction(id, action); setNotice(done); await refetch(); } catch (error) { setActionError(apiErrorMessage(error, "That did not work.")); } finally { setBusy(false); }
  }
  const status = data?.effective_status || "draft";
  const [statusLabel, statusColor] = COUPON_STATUS[status] || [status, D.textDim];

  return (
    <div style={page}>
      <PageHead crumb={<button type="button" onClick={onBack} style={linkStyle}>Coupons</button>} title={isNew ? "New coupon" : data.code}>
        <span style={chip(statusColor)}>{isNew ? "Draft" : statusLabel}</span>
        {!isNew && data.status === "active" && <button type="button" disabled={busy} onClick={() => act("pause", "Paused.")} style={button(D.panelBg, D.text, busy)}>Pause</button>}
        {!isNew && data.status === "paused" && <button type="button" disabled={busy} onClick={() => act("resume", "Resumed.")} style={button(D.panelBg, D.text, busy)}>Resume</button>}
        {!isNew && ["active", "paused"].includes(data.status) && <button type="button" disabled={busy} onClick={() => { if (window.confirm("End this coupon for good?")) act("end", "Ended."); }} style={button(D.panelBg, D.text, busy)}>End coupon</button>}
        {!isNew && data.status === "draft" && <button type="button" disabled={busy} onClick={async () => { if (!window.confirm("Delete this draft?")) return; try { await deleteCoupon(id); onBack(); } catch (error) { setActionError(apiErrorMessage(error, "Could not delete.")); } }} style={button(D.panelBg, D.text, busy)}>Delete draft</button>}
      </PageHead>
      <OffNotice data={data || { promos_enabled: false, off_notice: "Discounts are not applied at checkout yet. You can draft, edit and schedule here; nothing reaches customers until the owner switches checkout promotions on." }} />
      {actionError && <div role="alert" style={errorStyle}>{actionError}</div>}
      {notice && <div role="status" style={chip(D.green)}>{notice}</div>}
      {data?.paused_reason && <Honest tone="warn">{data.paused_reason}</Honest>}
      {!isNew && !editable && <Honest>A coupon can only be edited while it is a draft. Pause or end it, then make a new one.</Honest>}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 14, alignItems: "start" }}>
        <Section id="ce-rules" title="Rules">
          <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8 }} disabled={!editable}>
            <legend style={{ ...labelStyle, padding: 0 }}>Codes</legend>
            <label style={{ display: "flex", gap: 8, fontSize: "0.8rem" }}><input type="radio" name="codes" checked={!single} onChange={() => set({ code_mode: "shared" })} /><span><strong>One shared code</strong>: anyone with the code can use it, up to the limits below.</span></label>
            <label style={{ display: "flex", gap: 8, fontSize: "0.8rem" }}><input type="radio" name="codes" checked={single} onChange={() => set({ code_mode: "single_use", per_customer_limit: 1 })} /><span><strong>Single-use codes</strong>: unique codes like {form.code || "WB"}-7KQ2M, each works once. They are made when you save; sending them to people comes with campaigns.</span></label>
          </fieldset>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <label style={labelStyle}>{single ? "Code prefix" : "Code"}<input value={form.code} disabled={!editable} onChange={(e) => set({ code: e.target.value.toUpperCase() })} style={{ ...inputStyle, width: 180 }} /></label>
            <label style={labelStyle}>Discount type<select value={form.kind} disabled={!editable} onChange={(e) => set({ kind: e.target.value })} style={inputStyle}><option value="fixed">GH₵ off</option><option value="percent">% off</option></select></label>
            <label style={labelStyle}>{form.kind === "fixed" ? "Amount off (GH₵)" : "Percent off"}<input inputMode="decimal" value={form.value} disabled={!editable} onChange={(e) => set({ value: e.target.value })} style={{ ...inputStyle, width: 110 }} /></label>
            {form.kind === "percent" && <label style={labelStyle}>Up to (GH₵ per order)<input inputMode="decimal" value={form.max_discount} disabled={!editable} onChange={(e) => set({ max_discount: e.target.value })} style={{ ...inputStyle, width: 130 }} /></label>}
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <label style={labelStyle}>Minimum spend on items (GH₵)<input inputMode="decimal" value={form.min_spend} disabled={!editable} onChange={(e) => set({ min_spend: e.target.value })} style={{ ...inputStyle, width: 150 }} /></label>
            <label style={labelStyle}>{single ? "Number of codes" : "Total uses"}<input type="number" min={1} value={form.usage_limit} disabled={!editable} onChange={(e) => set({ usage_limit: e.target.value })} style={{ ...inputStyle, width: 110 }} /></label>
            {!single && <label style={labelStyle}>Per customer<input type="number" min={1} value={form.per_customer_limit} disabled={!editable} onChange={(e) => set({ per_customer_limit: e.target.value })} style={{ ...inputStyle, width: 100 }} /></label>}
            <label style={labelStyle}>Budget cap (GH₵, optional)<input inputMode="decimal" value={form.budget_cap} placeholder="uses x discount" disabled={!editable} onChange={(e) => set({ budget_cap: e.target.value })} style={{ ...inputStyle, width: 150 }} /></label>
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <label style={labelStyle}>Starts<input type="date" value={form.starts_at} disabled={!editable} onChange={(e) => set({ starts_at: e.target.value })} style={inputStyle} /></label>
            <label style={labelStyle}>Expires<input type="date" value={form.expires_at} disabled={!editable} onChange={(e) => set({ expires_at: e.target.value })} style={inputStyle} /></label>
            <label style={labelStyle}>Applies to<select value={form.category} disabled={!editable} onChange={(e) => set({ category: e.target.value })} style={inputStyle}><option value="">All categories</option><CategoryOptions categories={categories.data || []} /></select></label>
          </div>
          <div style={{ border: `1px solid ${D.cardBorder}`, borderRadius: 10, padding: 10, background: D.panelBg2 }}>
            <strong style={{ fontSize: "0.78rem" }}>Always on, can't be switched off</strong>
            <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: "0.78rem", lineHeight: 1.6 }}>
              <li>No stacking: one coupon per order, and never on a flash-sale price.</li>
              <li>AshantiHub pays the discount; the seller is paid the full price.</li>
              <li>The minimum spend counts items only.</li>
              <li>When the budget cap is reached the coupon pauses itself, and no order can pass the cap.</li>
            </ul>
          </div>
          {editable && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" disabled={busy || !form.code} onClick={() => save("draft")} style={button(D.panelBg, D.text, busy || !form.code)}>Save draft</button>
              <button type="button" disabled={busy || !form.code} onClick={() => save("activate")} style={button(D.gold, D.text, busy || !form.code)}>{needsApproval ? "Send to Super Admin for approval" : "Save and make it live"}</button>
            </div>
          )}
        </Section>
        <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
          <Section id="ce-bud" title="Most it can cost">
            {computedCap == null ? <Honest>Add an amount off (and an “up to” for a percentage) so the most it can cost is known.</Honest> : (
              <>
                <div style={{ fontSize: "1.6rem", fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{money(computedCap)}</div>
                <div style={dim}>{form.budget_cap !== "" ? "The budget cap you set" : `${form.usage_limit} uses x ${money(ceiling)}`}</div>
                <Honest tone={needsApproval ? "warn" : undefined}>{needsApproval ? `Above ${money(threshold)}, so Super Admin must approve it. No code works until they do.` : `At or under ${money(threshold)}: it can go live without approval.`}</Honest>
              </>
            )}
          </Section>
          <Section id="ce-abuse" title="Abuse checks">
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: "0.8rem", lineHeight: 1.6 }}>
              <li>Single-use codes work once, whoever has them.</li>
              <li>Per-customer limits count the same account and the same phone number, however it was typed.</li>
              <li>A cancelled or failed order gives the use back; a discount is never paid twice.</li>
            </ul>
            <div style={dim}>Device checks and fast-redemption alerts are not available: AshantiHub does not collect that data.</div>
          </Section>
          {data?.sample_codes?.length > 0 && (
            <Section id="ce-codes" title={`Codes · ${data.code_count}`}>
              <div style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: "0.78rem", lineHeight: 1.7 }}>{data.sample_codes.join(", ")}{data.code_count > data.sample_codes.length ? " …" : ""}</div>
              <div style={dim}>Sending codes to people arrives with campaigns. Until then these are not given to anyone.</div>
            </Section>
          )}
          {!isNew && <Section id="ce-sum" title="Summary"><div style={{ fontSize: "0.8rem" }}>{valueWord(data)} · {data.uses} of {data.usage_limit} used · cost so far {money(data.cost_to_date)}</div></Section>}
        </div>
      </div>
    </div>
  );
}
