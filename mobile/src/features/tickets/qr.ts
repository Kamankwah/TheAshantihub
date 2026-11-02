import QRCode from "qrcode";

/** The QR for a ticket code: dark modules row by row. It holds just the code, so a scan and a typed code reach the same check-in. */
export function qrMatrix(code: string): { size: number; dark: boolean[] } {
  const qr = QRCode.create(code, { errorCorrectionLevel: "M" });
  const size = qr.modules.size;
  return { size, dark: Array.from(qr.modules.data, (v) => v === 1) };
}
