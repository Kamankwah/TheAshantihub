import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiPost } from "../../../apiClient.js";
import { useBusinessReview } from "../../../hooks/useBusinessReview.js";
import { apiErrorMessage } from "../../../lib/apiErrorMessage.js";
import { D } from "../theme.js";
import { button, callout, chip, dim } from "./panelStyles.js";
import { alreadyBelongsText } from "./registrationCheckCopy.js";
import { errorStyle, eyebrow, formatDateTime, h3 } from "./portfolioParts.jsx";

// The KYC review sheet inside a business.kyc approval (/staff/approvals/<id>),
// read from GET /api/portfolio/businesses/<id>/review/: the owner, the
// business, its photos, the pin and the Ghana Post address decision, the
// duplicate and self-dealing checks (run again now, against today's
// records), the consent record and any fraud cases that mention it.
// canRecordAddress — the viewer decides this request, so the address buttons
// (POST /api/accounts/kyc/<id>/address-verify/, kyc.approve) show; the
// request can't be approved until a decision is recorded.

const KIND = { product: "Products", service: "Services" };
const SET_BY = { scout: "the scout's phone", owner: "the owner", operations: "Operations" };
const CHANNEL = { handover: "Hand-over on the scout's phone", link: "Claim link", self: "Registered online" };
const CONSENT_NOTE = {
  handover: "The owner accepted the terms and typed their own password on the hand-over screen. AshantiHub doesn't keep it on the scout's phone.",
  link: "The owner accepted the terms and set their own password from the claim link.",
};
const FLAG_STATUS = { open: ["Open", D.red], confirmed: ["Confirmed", D.red], dismissed: ["Dismissed", D.textFaint] };
const ON_HOLD = "Its KYC request is on hold until this case is decided — decide it in Fraud cases first.";

const section = { display: "flex", flexDirection: "column", gap: 8, paddingTop: 12, borderTop: `1px solid ${D.divider}` };
const grid = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(180px, 100%), 1fr))", gap: "8px 20px", margin: 0 };
const cell = { padding: "6px 8px", verticalAlign: "top", textAlign: "left" };
const text = { color: D.text, fontSize: "0.8rem" };

function Facts({ rows }) {
  return (
    <dl style={grid}>
      {rows.map(([name, value]) => (
        <div key={name} style={{ minWidth: 0 }}>
          <dt style={eyebrow}>{name}</dt>
          <dd style={{ margin: 0, color: D.text, fontSize: "0.8rem", fontWeight: 600, overflowWrap: "anywhere" }}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Photo({ label, url }) {
  return (
    <figure style={{ margin: 0, flex: "1 1 180px", maxWidth: 260 }}>
      {url ? (
        <a href={url} target="_blank" rel="noreferrer">
          <img src={url} alt={label} style={{ width: "100%", borderRadius: 10, border: `1px solid ${D.cardBorder}`, display: "block" }} />
        </a>
      ) : (
        <div style={{ ...dim, padding: "18px 12px", background: D.panelBg2, borderRadius: 10, border: `1px dashed ${D.cardBorder}`, textAlign: "center" }}>Not taken</div>
      )}
      <figcaption style={{ ...dim, marginTop: 4 }}>{label}</figcaption>
    </figure>
  );
}

function pinText(location) {
  if (location.lat == null || location.lng == null) return "No map pin — owners who register online give a Ghana Post address only.";
  const parts = [`Pin ${Number(location.lat).toFixed(6)}, ${Number(location.lng).toFixed(6)}`];
  if (location.accuracy_m != null) parts.push(`accuracy ±${Math.round(location.accuracy_m)} m`);
  parts.push(location.is_manual ? "placed by hand" : "not moved by hand");
  return parts.join(" · ");
}

// [check, result, what it means] for the checks table.
function checkRows(sheet) {
  const checks = sheet.checks || {};
  const owner = sheet.owner || {};
  const location = sheet.location || {};
  const exact = checks.exact || [];
  const similar = checks.similar || [];
  return [
    [
      "Exact duplicate",
      exact.length ? "Found" : "None found",
      exact.length
        ? exact.map(alreadyBelongsText).join(" ")
        : "The owner's sign-in phone was checked against every other business's sign-in, contact and payout MoMo numbers; the Ghana Post address and Ghana Card number were checked too.",
    ],
    [
      "Similar name within 50 m",
      similar.length ? "Flagged" : "None",
      similar.length
        ? similar.map((near) => `“${near.business_name}”, ${near.distance_m} m away, name match ${Number(near.similarity).toFixed(2)}`).join("; ")
        : location.lat == null ? "No map pin, so there is nothing nearby to compare." : "No business with a similar name has a pin within 50 m.",
    ],
    [
      "Self-dealing",
      checks.staff_match ? "Match" : "No match",
      checks.staff_match ? "The owner's phone matches an AshantiHub staff member's phone." : "The owner's phone matches no staff member's phone.",
    ],
    [
      "Pin accuracy",
      checks.accuracy_m != null ? `±${Math.round(checks.accuracy_m)} m` : "No pin",
      "The app refuses a pin rougher than 100 m unless the scout places it by hand.",
    ],
    [
      "Owner login",
      owner.needs_claim ? "Not set yet" : "Set",
      owner.needs_claim
        ? "The owner hasn't set their own password yet — the scout hands the phone over or sends a claim link."
        : owner.claimed_at ? `The owner set their own password ${formatDateTime(owner.claimed_at)}.` : "The owner registered online with their own password.",
    ],
  ];
}

export default function BusinessKycReview({ businessId, canRecordAddress = false }) {
  const { data: sheet, isLoading, isError, error, refetch } = useBusinessReview(businessId);
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);

  const recordAddress = async (verified) => {
    setActionError(null);
    setBusy(true);
    try {
      await apiPost(`/api/accounts/kyc/${businessId}/address-verify/`, { verified });
      await refetch();
      ["kyc-queue", "kyc-detail"].forEach((key) => queryClient.invalidateQueries({ queryKey: [key] }));
    } catch (err) {
      setActionError(apiErrorMessage(err, "Could not record the address decision. Please try again."));
    } finally {
      setBusy(false);
    }
  };

  if (isLoading) return <div style={dim}>Loading the KYC review…</div>;
  if (isError && error?.status === 403) return <div style={dim}>The KYC review sheet is for Operations and Super Admin.</div>;
  if (isError && error?.status === 404) return <div style={dim}>This business no longer exists.</div>;
  if (isError || !sheet) {
    return (
      <div role="alert" style={{ ...errorStyle, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        Couldn't load the KYC review.
        <button type="button" onClick={() => refetch()} style={button(D.panelBg, D.text)}>Try again</button>
      </div>
    );
  }

  const owner = sheet.owner || {};
  const business = sheet.business || {};
  const photos = sheet.photos || {};
  const location = sheet.location || {};
  const consent = sheet.consent;
  const flags = sheet.flags || [];
  const decided = location.address_verified_at != null;
  const verified = decided && location.address_verified === true;
  const wrong = decided && !location.address_verified;
  const onHold = flags.some((f) => f.kind === "self_dealing" && f.status === "open");
  const registered = sheet.registered_by_name ? `Registered by ${sheet.registered_by_name}` : "Registered online by the owner";
  const addressStatus = decided
    ? `${verified ? "✓ Address verified" : "✗ Address marked wrong"}${location.address_verified_by_name ? ` by ${location.address_verified_by_name}` : ""} · ${formatDateTime(location.address_verified_at)}`
    : "No decision yet — Approve is refused until the address decision is recorded.";

  return (
    <section aria-label="KYC review" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div>
        <div style={eyebrow}>KYC review</div>
        <div style={dim}>{`${registered} · ${formatDateTime(sheet.created_at)}`}</div>
      </div>
      {onHold && <div style={callout(D.red)}>{ON_HOLD}</div>}

      <div style={section}>
        <h3 style={h3}>Owner</h3>
        <Facts rows={[
          ["Full name", owner.full_name || "—"],
          ["Login phone", owner.login_phone || "—"],
          ["Email", owner.email || "Not given"],
          ["Ghana Card number", owner.ghana_card_number || "Not given"],
        ]} />
      </div>

      <div style={section}>
        <h3 style={h3}>Business</h3>
        <Facts rows={[
          ["Business name", business.business_name || "—"],
          ["Kind and category", [KIND[business.business_kind], business.category?.name].filter(Boolean).join(" · ") || "—"],
          ["Area", business.zone?.name || "—"],
          ["Opening hours", business.opening_hours || "Not given"],
          ["Formally registered", `${business.is_formal ? "Yes" : "No"} (${business.tin_given ? "TIN given" : "no TIN given"})`],
        ]} />
      </div>

      <div style={section}>
        <h3 style={h3}>Photos</h3>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <Photo label="Signboard" url={photos.signboard} />
          <Photo label="Ghana Card · front" url={photos.ghana_card_front} />
          {photos.ghana_card_back && <Photo label="Ghana Card · back" url={photos.ghana_card_back} />}
        </div>
      </div>

      <div style={section}>
        <h3 style={h3}>Location</h3>
        <div style={text}>{pinText(location)}</div>
        {location.lat != null && (
          <div style={dim}>{`Pin from ${SET_BY[location.set_by] || "an unrecorded source"}${location.set_at ? ` · ${formatDateTime(location.set_at)}` : ""}`}</div>
        )}
        {location.lat != null && (
          <a href={`https://www.openstreetmap.org/?mlat=${location.lat}&mlon=${location.lng}#map=18/${location.lat}/${location.lng}`}
            target="_blank" rel="noreferrer" style={{ color: D.deepGold, fontSize: "0.78rem", fontWeight: 700, alignSelf: "flex-start" }}>Open the pin on a map</a>
        )}
        <div style={text}>{`Ghana Post address as typed: ${location.gps_address || "—"}`}</div>
        <div style={callout(decided ? (verified ? D.green : D.red) : D.amber)}>{addressStatus}</div>
        {canRecordAddress && (
          <div role="group" aria-label="Ghana Post address decision" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button type="button" aria-pressed={verified} disabled={busy} onClick={() => recordAddress(true)}
              style={button(verified ? D.green : D.panelBg, verified ? D.panelBg : D.green, busy)}>Address verified</button>
            <button type="button" aria-pressed={wrong} disabled={busy} onClick={() => recordAddress(false)}
              style={button(wrong ? D.red : D.panelBg, wrong ? D.panelBg : D.red, busy)}>Address wrong</button>
          </div>
        )}
        {actionError && <div role="alert" style={errorStyle}>{actionError}</div>}
      </div>

      <div style={section}>
        <h3 style={h3}>Duplicate and self-dealing checks</h3>
        <div style={{ overflowX: "auto" }}>
          <table aria-label="Duplicate and self-dealing checks" style={{ borderCollapse: "collapse", width: "100%", minWidth: 480, ...text }}>
            <thead>
              <tr style={{ color: D.textDim }}>
                <th style={cell}>Check</th><th style={cell}>Result</th><th style={cell}>What it means</th>
              </tr>
            </thead>
            <tbody>
              {checkRows(sheet).map(([check, result, means]) => (
                <tr key={check} style={{ borderTop: `1px solid ${D.divider}` }}>
                  <th scope="row" style={{ ...cell, fontWeight: 700 }}>{check}</th>
                  <td style={{ ...cell, fontWeight: 700 }}>{result}</td>
                  <td style={cell}>{means}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div style={section}>
        <h3 style={h3}>Fraud cases</h3>
        {flags.length === 0 ? (
          <div style={dim}>No fraud case mentions this business.</div>
        ) : (
          <ul aria-label="Fraud cases about this business" style={{ margin: 0, paddingLeft: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 6, ...text }}>
            {flags.map((f) => {
              const [statusLabel, statusColor] = FLAG_STATUS[f.status] || [f.status, D.textFaint];
              return (
                <li key={f.id} style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                  <span style={chip(statusColor)}>{statusLabel}</span>
                  <span>{`${f.kind_label} · ${f.title}`}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div style={section}>
        <h3 style={h3}>Consent record</h3>
        {consent ? (
          <>
            <Facts rows={[
              ["Terms version", consent.terms_version || "—"],
              ["Accepted", formatDateTime(consent.accepted_at) || "—"],
              ["Channel", CHANNEL[consent.channel] || consent.channel || "—"],
              ["Started by", consent.staff_name || "—"],
              ["Device", consent.user_agent || "Not recorded"],
              ["IP address", consent.ip || "Not recorded"],
            ]} />
            {CONSENT_NOTE[consent.channel] && <div style={dim}>{CONSENT_NOTE[consent.channel]}</div>}
          </>
        ) : (
          <div style={dim}>No consent recorded yet. The owner accepts the terms when they set their own password.</div>
        )}
      </div>
    </section>
  );
}
