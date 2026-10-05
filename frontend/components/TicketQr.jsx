import { useEffect, useState } from "react";
import QRCode from "qrcode";

// ─── TicketQr ───────────────────────────────────────────────────────────────
// A ticket's code as a QR image, for the organiser to scan at the gate
// (EventCheckinPanel → QrScanner). Drawn on the device as an SVG; the code
// never goes to a third-party QR service. The QR holds just the ticket code,
// so a scan and a typed code hit the same check-in endpoint.
export const QR_OPTIONS = { errorCorrectionLevel: "M", margin: 2 };

export default function TicketQr({ code, size = 120 }) {
  const [src, setSrc] = useState(null);

  useEffect(() => {
    let live = true;
    QRCode.toString(code, { ...QR_OPTIONS, type: "svg" })
      .then((svg) => { if (live) setSrc(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`); })
      .catch(() => { if (live) setSrc(null); });
    return () => { live = false; };
  }, [code]);

  if (!src) return null;
  return (
    <img
      src={src}
      alt={`QR code for ticket ${code}`}
      width={size}
      height={size}
      style={{ display: "block", background: "#fff", borderRadius: 8, padding: 4 }}
    />
  );
}
