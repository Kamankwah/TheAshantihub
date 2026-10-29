import { D } from "../theme.js";

// What staff must see before a listing goes public: its videos (played, not just counted) and every variant
// (name and attribute values are public text). Shared by the listing queue, the Super Admin review sheet and the
// edit (revision) diff.

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const subHead = { color: D.textFaint, fontSize: "0.6rem", fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", margin: "10px 0 4px" };
const cell = { padding: "4px 8px", fontSize: "0.72rem", verticalAlign: "top", borderBottom: `1px solid ${D.divider}`, wordBreak: "break-word", textAlign: "left" };

export function VideoLine({ video, removed = false }) {
  let body;
  if (video.kind === "youtube") {
    body = YOUTUBE_ID.test(video.youtube_id || "")
      ? <iframe title="YouTube video" src={`https://www.youtube-nocookie.com/embed/${video.youtube_id}`} allowFullScreen loading="lazy" style={{ width: 240, height: 135, border: 0, borderRadius: 8 }} />
      : null;
  } else if (video.status === "ready" && video.url) {
    body = <video controls src={video.url} style={{ width: 240, maxHeight: 160, borderRadius: 8, background: "#000" }} />;
  } else if (video.status === "failed") {
    body = <span style={{ color: D.red, fontSize: "0.72rem" }}>Video could not be processed</span>;
  } else {
    body = <span style={{ color: D.amber, fontSize: "0.72rem" }}>Video is still being processed</span>;
  }
  if (body === null) return null;
  return (
    <div style={{ marginBottom: 6, opacity: removed ? 0.6 : 1 }}>
      {removed && <div style={{ color: D.red, fontSize: "0.66rem", fontWeight: 700 }}>To be removed:</div>}
      {body}
    </div>
  );
}

export function VideosBlock({ videos }) {
  if (!videos || videos.length === 0) return null;
  return (
    <>
      <div style={subHead}>Videos</div>
      {videos.map((v) => <VideoLine key={v.id} video={v} />)}
    </>
  );
}

const attributesText = (attributes) => Object.entries(attributes || {}).map(([name, value]) => `${name}: ${value}`).join(", ");

export function VariantsTable({ variants }) {
  if (!variants || variants.length === 0) return null;
  return (
    <>
      <div style={subHead}>Options (variants)</div>
      <table aria-label="Variants" style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>{["Name", "Details", "Price", "Stock", "Status"].map((h) => <th key={h} scope="col" style={{ ...cell, color: D.textFaint, fontSize: "0.6rem", fontWeight: 800, textTransform: "uppercase" }}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {variants.map((v) => (
            <tr key={v.id} style={v.is_active ? undefined : { opacity: 0.6 }}>
              <th scope="row" style={{ ...cell, color: D.text, fontWeight: 700 }}>{v.label}</th>
              <td style={{ ...cell, color: D.textDim }}>{attributesText(v.attributes) || "—"}</td>
              <td style={{ ...cell, color: D.text }}>{`GHS ${v.price_amount}`}</td>
              <td style={{ ...cell, color: D.text }}>{v.stock_quantity == null ? "Not counted" : v.stock_quantity}</td>
              <td style={{ ...cell, color: D.textDim }}>{v.is_active ? "On" : "Switched off"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
