import { D } from "./theme.js";

// Shared by the business slide form, the staff approval panels and the day-one slide form.
export const MAX_DAYS_NOTE = "A hero slide can run for at most 30 days.";
const YT_ID = /^[A-Za-z0-9_-]{11}$/;

const dayFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Accra", day: "numeric", month: "short", year: "numeric" });
export const slideDay = (iso) => (iso ? dayFmt.format(new Date(iso)) : "");

// "Runs 7 Nov 2026 to 14 Nov 2026", or an honest line for a row made before slides had dates.
export function slideWindow(slide) {
  if (!slide?.starts_at || !slide?.ends_at) return "No dates (submitted before slides had dates)";
  return `Runs ${slideDay(slide.starts_at)} to ${slideDay(slide.ends_at)}`;
}

// Who made it: the business, or AshantiHub staff for a day-one slide.
export function slideMaker(slide) {
  if (slide?.business_owner_name) return slide.business_owner_name;
  if (slide?.created_by_staff_name) return `AshantiHub (${slide.created_by_staff_name})`;
  return "AshantiHub";
}

const frame = { objectFit: "cover", borderRadius: 10, background: D.panelBg2, flexShrink: 0 };

// A slide's picture: image, uploaded video, or YouTube. `embed` plays YouTube through the no-cookie embed;
// without it a YouTube slide shows its thumbnail only.
export function HeroSlidePreview({ slide, size = 80, embed = false, maxWidth = 480 }) {
  const id = YT_ID.test(slide?.youtube_id || "") ? slide.youtube_id : null;
  const box = embed ? { width: "100%", maxWidth, aspectRatio: "16 / 9", height: "auto" } : { width: size, height: size };
  if (id && embed) {
    return <iframe title="YouTube preview" src={`https://www.youtube-nocookie.com/embed/${id}`} loading="lazy" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" style={{ ...frame, ...box, border: 0 }} />;
  }
  if (id) return <img src={`https://i.ytimg.com/vi/${id}/hqdefault.jpg`} alt="YouTube video thumbnail" style={{ ...frame, ...box }} />;
  const video = slide?.video_file || (slide?.media_type === "video" ? slide?.media : null);
  if (video) return <video src={video} muted controls={embed} preload="metadata" style={{ ...frame, ...box, background: "#000" }} />;
  return <img src={slide?.media || ""} alt={slide?.caption || slide?.title || "Slide picture"} style={{ ...frame, ...box }} />;
}
