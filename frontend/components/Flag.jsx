// Small Ghana-flag SVG badge used throughout the app (logo, loading screen,
// navbar, etc.). Extracted from App.jsx so it can be shared with the
// extracted Navbar without creating a circular import back into App.jsx.
export default function Flag({ w = 50, h = 33 }) {
  return (
    <svg width={w} height={h} viewBox="0 0 54 36" style={{ borderRadius: 4, boxShadow: "0 2px 8px rgba(0,0,0,0.4)", border: "1px solid #ffffff33", display: "block" }}>
      <rect x="0" y="0" width="54" height="12" fill="#D4A017" />
      <rect x="0" y="12" width="54" height="12" fill="#1A1A1A" />
      <rect x="0" y="24" width="54" height="12" fill="#006400" />
      <rect x="0" y="11" width="54" height="1.5" fill="white" opacity="0.6" />
      <rect x="0" y="23.5" width="54" height="1.5" fill="white" opacity="0.6" />
      <g transform="translate(27,18)">
        <rect x="-8" y="-4.5" width="16" height="3" rx="1.5" fill="#D4A017" />
        <rect x="-5" y="-1.5" width="3" height="4" rx="1" fill="#D4A017" />
        <rect x="2" y="-1.5" width="3" height="4" rx="1" fill="#D4A017" />
        <rect x="-7" y="2.5" width="14" height="2.5" rx="1.2" fill="#D4A017" />
      </g>
    </svg>
  );
}
