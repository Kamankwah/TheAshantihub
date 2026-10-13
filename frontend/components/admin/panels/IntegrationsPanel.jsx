import { useIntegrations } from "../../../hooks/useSettingsScreens.js";
import { D, glassCard } from "../theme.js";
import { chip, dim } from "./panelStyles.js";
import { Status, Title, page } from "./insightsParts.jsx";

// ─── Super Admin 24 Integrations ─────────────────────────────────────────────
// Read-only. Each service's state is worked out on the server from which
// settings exist; it never reaches the provider, and no key, secret or address
// is shown or typed here (keys live in the server's environment).
const STATES = {
  connected: ["Connected", D.green],
  simulated: ["Simulated", D.amber],
  not_connected: ["Not connected", D.textDim],
};

export default function IntegrationsPanel() {
  const query = useIntegrations();
  return (
    <div style={page}>
      <Title>Integrations</Title>
      <div style={dim}>Keys are kept on the server and are never shown here. "Connected" means the setting exists on the server; it does not mean the provider was reached just now. Where a service is not connected, the rest of AshantiHub says so instead of pretending.</div>
      <Status isLoading={query.isLoading} isError={query.isError}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 }}>
          {(query.data?.items || []).map((item) => {
            const [label, color] = STATES[item.status] || [item.status, D.textDim];
            return (
              <section key={item.key} aria-label={item.name} style={{ ...glassCard, padding: 14, display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                  <h3 style={{ margin: 0, color: D.text, fontSize: "0.95rem", fontWeight: 800 }}>{item.name}</h3>
                  <span style={chip(color)}>{label}</span>
                </div>
                <div style={dim}>{item.provider}</div>
                <div style={{ color: D.text, fontSize: "0.82rem" }}>{item.summary}</div>
                {item.missing.length > 0 && (
                  <div style={{ fontSize: "0.78rem", color: D.text }}>
                    <strong>What is missing: </strong>{item.missing.join("; ")}.
                  </div>
                )}
                {item.note && <div style={dim}>{item.note}</div>}
              </section>
            );
          })}
        </div>
      </Status>
    </div>
  );
}
