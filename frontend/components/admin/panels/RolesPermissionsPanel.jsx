import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiPost } from "../../../apiClient.js";
import { useRoleMatrix } from "../../../hooks/usePeople.js";
import { apiErrorMessage } from "../../../lib/apiErrorMessage.js";
import { D } from "../theme.js";
import { button, callout, dim } from "./panelStyles.js";
import { LoadState, ScreenHeader, col } from "./marketplaceParts.jsx";
import { RolePill, note, plural } from "./peopleParts.jsx";
import { card, errorStyle, h3 } from "./portfolioParts.jsx";

// Super Admin > Roles & permissions (screen 08): the role-level editor. Tick a
// box to change what a whole role can do; nothing is saved until you have seen
// exactly what would change and re-entered your password. Super Admin's own
// role is locked, and a few permissions cannot be handed to a role at all
// (changing roles, approval rules, step-in, staff management, co-signing): the
// box is disabled and says why. Only permissions that exist are listed; ones a
// later phase creates (payouts, campaigns, customer exports) appear when it does.

const key = (role, code) => `${role}|${code}`;

export default function RolesPermissionsPanel() {
  const queryClient = useQueryClient();
  const query = useRoleMatrix();
  const [pending, setPending] = useState({}); // "role|code" -> desired state
  const [preview, setPreview] = useState(null);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const data = query.data;

  const base = {};
  data?.groups.forEach((g) => g.permissions.forEach((p) => Object.entries(p.roles).forEach(([role, has]) => { base[key(role, p.codename)] = has; })));
  const changes = Object.entries(pending).map(([k, grant]) => { const [role, permission] = k.split("|"); return { role, permission, grant }; });
  const stateOf = (role, code) => (key(role, code) in pending ? pending[key(role, code)] : base[key(role, code)]);

  const toggle = (role, code) => {
    setPreview(null); setMessage(null); setError(null);
    setPending((cur) => {
      const k = key(role, code);
      const next = { ...cur };
      const want = !(k in cur ? cur[k] : base[k]);
      if (want === base[k]) delete next[k]; else next[k] = want;
      return next;
    });
  };
  const discard = () => { setPending({}); setPreview(null); setError(null); };
  const review = async () => {
    setBusy(true); setError(null);
    try { setPreview(await apiPost("/api/people/roles/preview/", { changes })); }
    catch (err) { setError(apiErrorMessage(err, "Could not work out what would change.")); }
    finally { setBusy(false); }
  };
  const save = async () => {
    setBusy(true); setError(null);
    try {
      const result = await apiPost("/api/people/roles/save/", { changes });
      setMessage(`Saved ${plural(result.saved, "change", "changes")}. ${plural(result.people_affected, "person", "people")} reconnected with their new permissions.`);
      setPending({}); setPreview(null);
      queryClient.invalidateQueries({ queryKey: ["staff-roster"] });
    } catch (err) { setError(apiErrorMessage(err, "Could not save the changes.")); }
    finally { setBusy(false); }
  };

  return (
    <div style={col}>
      <ScreenHeader title="Roles & permissions" note={data ? `${plural(data.roles.length, "role", "roles")} · ${data.permission_count} permissions that exist today.` : "What each role can do."}>
        {changes.length > 0 && <>
          <span role="status" style={{ ...dim, alignSelf: "center" }}>{`${plural(changes.length, "unsaved change", "unsaved changes")}`}</span>
          <button type="button" onClick={review} disabled={busy} style={button(D.gold, D.text, busy)}>Review and save</button>
          <button type="button" onClick={discard} style={button(D.panelBg, D.text)}>Discard changes</button>
        </>}
      </ScreenHeader>
      <LoadState query={query} what="the roles" />
      {message && <div role="status" style={callout(D.green)}>{message}</div>}
      {error && <div role="alert" style={errorStyle}>{error}</div>}

      {preview && (
        <section aria-label="Before you save" style={card}>
          <h3 style={h3}>{`Before you save · ${plural(preview.count, "change", "changes")} · ${plural(preview.people_affected, "person", "people")} affected`}</h3>
          {preview.exceptions > 0 && <div style={dim}>{`${plural(preview.exceptions, "individual exception exists", "individual exceptions exist")}; they are named below.`}</div>}
          {preview.changes.map((c) => (
            <div key={`${c.role}-${c.permission}`} style={{ fontSize: "0.82rem", color: D.text, borderTop: `1px solid ${D.divider}`, paddingTop: 8 }}>
              <div><b>{`${c.role_label} · ${c.grant ? "can now" : "can no longer"} ${c.description}`}</b> <span style={dim}>{c.permission}</span></div>
              <div>{c.effect}</div>
              <div style={dim}>{plural(c.people, "person", "people")} in this role</div>
            </div>
          ))}
          <div style={note}>Saving applies the changes at once. Everyone affected is reconnected with their new permissions, and the change is recorded in the audit log with before and after. It asks for your password.</div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button type="button" onClick={discard} style={button(D.panelBg, D.text)}>Discard changes</button>
            <button type="button" onClick={save} disabled={busy} style={button(D.gold, D.text, busy)}>{busy ? "Saving…" : `Save ${plural(preview.count, "change", "changes")}`}</button>
          </div>
        </section>
      )}

      {data && (
        <section aria-label="What each role can do" style={card}>
          <h3 style={h3}>What each role can do</h3>
          <div style={dim}>Super Admin always holds every permission. Tick a box to change a role; a greyed box cannot be changed, and its tooltip says why. A person's own grants and revokes sit on top of their role.</div>
          <div style={{ overflowX: "auto" }}>
            <table aria-label="Role permissions" style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.78rem", color: D.text, minWidth: 760 }}>
              <thead>
                <tr>
                  <th scope="col" style={{ textAlign: "left", padding: "6px 8px", color: D.textDim }}>Permission</th>
                  {data.roles.map((r) => (
                    <th scope="col" key={r.name} style={{ padding: "6px 8px", textAlign: "center" }}>
                      <RolePill role={r.name} />
                      <div style={dim}>{plural(r.people, "person", "people")}</div>
                      <div style={dim}>{r.locked ? "locked" : r.grants || r.revokes ? [r.grants ? plural(r.grants, "grant", "grants") : null, r.revokes ? plural(r.revokes, "revoke", "revokes") : null].filter(Boolean).join(" · ") : "no exceptions"}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              {data.groups.map((g) => (
                <tbody key={g.name}>
                  <tr><th colSpan={data.roles.length + 1} scope="colgroup" style={{ textAlign: "left", padding: "10px 8px 4px", color: D.text, fontSize: "0.8rem" }}>{g.name}</th></tr>
                  {g.permissions.map((p) => (
                    <tr key={p.codename}>
                      <th scope="row" style={{ textAlign: "left", padding: "4px 8px", fontWeight: 600 }}>{p.description}<div style={{ ...dim, fontSize: "0.68rem" }}>{p.codename}</div></th>
                      {data.roles.map((r) => {
                        const lockedWhy = p.locked_for[r.name];
                        const checked = stateOf(r.name, p.codename);
                        const changed = key(r.name, p.codename) in pending;
                        return (
                          <td key={r.name} style={{ textAlign: "center", padding: 4, background: changed ? D.warnBg : "transparent" }}>
                            <input type="checkbox" checked={checked} disabled={Boolean(lockedWhy) || r.locked} title={lockedWhy || undefined}
                              aria-label={`${r.label}: ${p.description}${changed ? (checked ? " (being added)" : " (being removed)") : ""}`}
                              onChange={() => toggle(r.name, p.codename)} />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
          </div>
          <div style={note}>Permissions for payouts, payroll, campaigns and customer exports are not listed because they do not exist yet; each appears here when its phase adds it.</div>
        </section>
      )}
    </div>
  );
}
