import { useState } from "react";
import { C, optionStyle } from "../theme.js";
import { apiPatch, apiPost } from "../apiClient.js";
import { useMyEventTicketTypes } from "../hooks/useMyEventTicketTypes.js";

// ─── EventTicketTypesPanel ─────────────────────────────────────────────────
// Organizer's ticket-tier CRUD editor (event ticketing + escrow work).
// Self-fetches useMyEventTicketTypes(eventId, {enabled:true}) — mounted only
// while EventSubmissionPanel's per-event "🎟️ Tickets" toggle is open for
// this event id, same "only fetch once its panel is actually opened"
// convention as EventAttendeesPanel/useEventAttendees. Mutations
// (create/update) are plain apiPost/apiPatch calls in a try/catch with a
// local actionError state, refetch() on success — this codebase's
// established convention (CLAUDE.md), not a useMutation hook.
const initialCreateForm = {
  name: "",
  description: "",
  price: "",
  delivery_method: "digital",
  quantity_total: "",
};

export default function EventTicketTypesPanel({ eventId }) {
  const { data: ticketTypes, isLoading, isError, refetch } = useMyEventTicketTypes(eventId, { enabled: true });
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState(initialCreateForm);
  const [creating, setCreating] = useState(false);
  const [actionError, setActionError] = useState(null);

  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const [saving, setSaving] = useState(false);

  const setCreateField = (key) => (e) => setCreateForm((f) => ({ ...f, [key]: e.target.value }));

  const startEdit = (tt) => {
    setActionError(null);
    setEditingId(tt.id);
    setEditForm({
      name: tt.name,
      description: tt.description || "",
      price: tt.price,
      delivery_method: tt.delivery_method,
      quantity_total: tt.quantity_total ?? "",
    });
  };

  const setEditField = (key) => (e) => setEditForm((f) => ({ ...f, [key]: e.target.value }));

  const saveEdit = async () => {
    if (!editingId || !editForm) return;
    setActionError(null);
    setSaving(true);
    try {
      const body = {
        name: editForm.name.trim(),
        description: editForm.description.trim(),
        price: editForm.price,
        delivery_method: editForm.delivery_method,
        quantity_total: editForm.quantity_total === "" ? null : Number(editForm.quantity_total),
      };
      await apiPatch(`/api/events/ticket-types/${editingId}/`, body);
      setEditingId(null);
      setEditForm(null);
      refetch();
    } catch (err) {
      setActionError("Could not save this ticket type — please check the fields and try again.");
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (tt) => {
    setActionError(null);
    try {
      await apiPatch(`/api/events/ticket-types/${tt.id}/`, { is_active: !tt.is_active });
      refetch();
    } catch (err) {
      setActionError("Could not update this ticket type.");
    }
  };

  const createTicketType = async (e) => {
    e.preventDefault();
    setActionError(null);
    setCreating(true);
    try {
      const body = {
        name: createForm.name.trim(),
        description: createForm.description.trim(),
        price: createForm.price,
        delivery_method: createForm.delivery_method,
        quantity_total: createForm.quantity_total === "" ? null : Number(createForm.quantity_total),
        is_active: true,
      };
      await apiPost(`/api/events/${eventId}/ticket-types/`, body);
      setCreateForm(initialCreateForm);
      setShowCreate(false);
      refetch();
    } catch (err) {
      setActionError("Could not create this ticket type — please check the fields and try again.");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div style={{ marginTop: 10, background: "rgba(255,255,255,0.03)", borderRadius: 10, padding: "10px 12px" }}>
      {actionError && <div style={{ marginBottom: 8, color: "#ffb4b4", fontSize: "0.72rem" }}>{actionError}</div>}

      {isLoading && <div style={{ color: "rgba(255,255,255,0.55)", fontSize: "0.74rem" }}>Loading ticket types…</div>}
      {isError && (
        <div style={{ color: "#ffb4b4", fontSize: "0.74rem" }}>
          Could not load ticket types.{" "}
          <button onClick={() => refetch()} style={retryBtnStyle}>Retry</button>
        </div>
      )}

      {!isLoading && !isError && (ticketTypes?.length ?? 0) === 0 && (
        <div style={{ color: "rgba(255,255,255,0.5)", fontSize: "0.74rem", marginBottom: 8 }}>No ticket types yet.</div>
      )}

      {ticketTypes?.map((tt) => (
        <div key={tt.id} style={{ padding: "8px 0", borderTop: "1px solid rgba(255,255,255,0.08)" }}>
          {editingId === tt.id ? (
            <div>
              <input value={editForm.name} onChange={setEditField("name")} placeholder="Name" style={inputStyle} />
              <textarea value={editForm.description} onChange={setEditField("description")} placeholder="Description" rows={2} style={{ ...inputStyle, resize: "vertical" }} />
              <div style={{ display: "flex", gap: 6 }}>
                <input type="number" min={0} step="0.01" value={editForm.price} onChange={setEditField("price")} placeholder="Price (GHS)" style={{ ...inputStyle, flex: 1 }} />
                <select value={editForm.delivery_method} onChange={setEditField("delivery_method")} style={{ ...inputStyle, flex: 1 }}>
                  <option value="digital" style={optionStyle}>Digital</option>
                  <option value="physical" style={optionStyle}>Physical</option>
                </select>
              </div>
              <input type="number" min={0} value={editForm.quantity_total} onChange={setEditField("quantity_total")} placeholder="Quantity total (blank = unlimited)" style={inputStyle} />
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button onClick={saveEdit} disabled={saving} style={saveBtnStyle}>{saving ? "Saving…" : "Save"}</button>
                <button onClick={() => { setEditingId(null); setEditForm(null); }} style={cancelBtnStyle}>Cancel</button>
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
              <div>
                <div style={{ color: "white", fontWeight: 700, fontSize: "0.8rem" }}>
                  {tt.name}{" "}
                  <span style={{ background: tt.delivery_method === "digital" ? `${C.kente2}33` : `${C.kente3}33`, color: tt.delivery_method === "digital" ? C.kente2 : C.kente3, fontSize: "0.6rem", fontWeight: 700, padding: "2px 8px", borderRadius: 20, marginLeft: 4 }}>
                    {tt.delivery_method === "digital" ? "Digital" : "Physical"}
                  </span>
                  {!tt.is_active && (
                    <span style={{ background: "rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.6)", fontSize: "0.6rem", fontWeight: 700, padding: "2px 8px", borderRadius: 20, marginLeft: 4 }}>
                      Inactive
                    </span>
                  )}
                </div>
                {tt.description && <div style={{ color: "rgba(255,255,255,0.55)", fontSize: "0.72rem", margin: "3px 0" }}>{tt.description}</div>}
                <div style={{ color: C.lightGold, fontSize: "0.72rem" }}>
                  GHS {tt.price} · Sold {tt.quantity_sold} / {tt.quantity_total ?? "∞"}
                </div>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={() => startEdit(tt)} style={smallBtnStyle}>✏️ Edit</button>
                <button onClick={() => toggleActive(tt)} style={smallBtnStyle}>{tt.is_active ? "Deactivate" : "Reactivate"}</button>
              </div>
            </div>
          )}
        </div>
      ))}

      <div style={{ marginTop: 10 }}>
        <button onClick={() => setShowCreate((s) => !s)} style={addBtnStyle}>
          {showCreate ? "✕ Close" : "+ Add Ticket Type"}
        </button>
      </div>

      {showCreate && (
        <form onSubmit={createTicketType} style={{ marginTop: 10, background: "rgba(255,255,255,0.03)", borderRadius: 8, padding: "10px 12px" }}>
          <input required value={createForm.name} onChange={setCreateField("name")} placeholder="Name (e.g. General Admission)" style={inputStyle} />
          <textarea value={createForm.description} onChange={setCreateField("description")} placeholder="Description (optional)" rows={2} style={{ ...inputStyle, resize: "vertical" }} />
          <div style={{ display: "flex", gap: 6 }}>
            <input required type="number" min={0} step="0.01" value={createForm.price} onChange={setCreateField("price")} placeholder="Price (GHS)" style={{ ...inputStyle, flex: 1 }} />
            <select value={createForm.delivery_method} onChange={setCreateField("delivery_method")} style={{ ...inputStyle, flex: 1 }}>
              <option value="digital" style={optionStyle}>Digital</option>
              <option value="physical" style={optionStyle}>Physical</option>
            </select>
          </div>
          <input type="number" min={0} value={createForm.quantity_total} onChange={setCreateField("quantity_total")} placeholder="Quantity total (blank = unlimited)" style={inputStyle} />
          <button type="submit" disabled={creating} style={{ ...saveBtnStyle, marginTop: 8, width: "100%" }}>
            {creating ? "Creating…" : "Create Ticket Type"}
          </button>
        </form>
      )}
    </div>
  );
}

const inputStyle = {
  width: "100%",
  padding: "7px 10px",
  borderRadius: 8,
  border: "1.5px solid rgba(255,255,255,0.25)",
  fontSize: "0.76rem",
  background: "rgba(255,255,255,0.08)",
  color: "white",
  fontFamily: "inherit",
  boxSizing: "border-box",
  marginTop: 6,
};

const smallBtnStyle = {
  background: "rgba(255,255,255,0.08)",
  color: "white",
  border: "1px solid rgba(255,255,255,0.22)",
  borderRadius: 20,
  padding: "5px 12px",
  fontWeight: 700,
  fontSize: "0.68rem",
  cursor: "pointer",
  fontFamily: "inherit",
};

const saveBtnStyle = {
  background: C.kente2,
  color: "white",
  border: "none",
  borderRadius: 20,
  padding: "6px 14px",
  fontWeight: 700,
  fontSize: "0.72rem",
  cursor: "pointer",
  fontFamily: "inherit",
};

const cancelBtnStyle = {
  background: "rgba(255,255,255,0.1)",
  color: "white",
  border: "1px solid rgba(255,255,255,0.25)",
  borderRadius: 20,
  padding: "6px 14px",
  fontWeight: 700,
  fontSize: "0.72rem",
  cursor: "pointer",
  fontFamily: "inherit",
};

const addBtnStyle = {
  background: C.gold,
  color: C.darkBrown,
  border: "none",
  borderRadius: 20,
  padding: "6px 14px",
  fontWeight: 800,
  fontSize: "0.72rem",
  cursor: "pointer",
  fontFamily: "inherit",
};

const retryBtnStyle = {
  background: "none",
  border: `1px solid ${C.kente1}`,
  color: C.kente1,
  borderRadius: 20,
  padding: "1px 8px",
  fontSize: "0.68rem",
  fontWeight: 700,
  cursor: "pointer",
};
