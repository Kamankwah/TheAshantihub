import { useEffect, useRef, useState } from "react";
import { C } from "../theme.js";

// ─── QrScanner ──────────────────────────────────────────────────────────────
// Reads a ticket QR with the device camera for EventCheckinPanel. Decodes with
// the browser's BarcodeDetector where it reads QR (Chrome on Android), and with
// jsQR elsewhere (iPhone Safari); jsQR is imported only when a scan starts, so
// it stays out of the main bundle. Hands the first code it reads to
// onDetected and turns the camera off. Needs HTTPS and the user's camera
// permission. `openCamera`/`createDetector` are injectable for tests (jsdom
// has no camera).
async function defaultOpenCamera() {
  return navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
}

async function defaultCreateDetector() {
  if ("BarcodeDetector" in window) {
    const formats = await window.BarcodeDetector.getSupportedFormats?.().catch(() => []);
    if (formats?.includes("qr_code")) {
      const detector = new window.BarcodeDetector({ formats: ["qr_code"] });
      return { detect: async (video) => (await detector.detect(video))[0]?.rawValue ?? null };
    }
  }
  const { default: jsQR } = await import("jsqr");
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  return {
    detect: async (video) => {
      const width = video.videoWidth;
      const height = video.videoHeight;
      if (!width || !height) return null;
      canvas.width = width;
      canvas.height = height;
      ctx.drawImage(video, 0, 0, width, height);
      const { data } = ctx.getImageData(0, 0, width, height);
      return jsQR(data, width, height)?.data ?? null;
    },
  };
}

export default function QrScanner({ onDetected, onClose, openCamera = defaultOpenCamera, createDetector = defaultCreateDetector, intervalMs = 250 }) {
  const videoRef = useRef(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let stream = null;
    let timer = null;
    let done = false;
    const stop = () => {
      clearTimeout(timer);
      stream?.getTracks?.().forEach((track) => track.stop());
    };

    (async () => {
      try {
        stream = await openCamera();
        if (done) return stop();
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          try { await video.play?.(); } catch { /* autoplay can refuse; frames still arrive once it plays */ }
        }
        const detector = await createDetector();
        const tick = async () => {
          if (done) return;
          const code = await detector.detect(video).catch(() => null);
          if (done) return;
          if (code) {
            done = true;
            stop();
            onDetected(code);
            return;
          }
          timer = setTimeout(tick, intervalMs);
        };
        tick();
      } catch {
        if (!done) setError("Can't open the camera. Allow camera access, or type the code instead.");
      }
    })();

    return () => { done = true; stop(); };
    // Runs once per mount: the scanner is mounted only while it is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{ marginBottom: 10 }}>
      {error ? (
        <div style={{ color: "#ffb4b4", fontSize: "0.72rem", marginBottom: 6 }}>{error}</div>
      ) : (
        <video
          ref={videoRef}
          muted
          playsInline
          aria-label="Camera view for scanning a ticket QR code"
          style={{ width: "100%", maxWidth: 320, borderRadius: 10, background: "#000", display: "block" }}
        />
      )}
      <button
        type="button"
        onClick={onClose}
        aria-label="Close scanner"
        style={{ marginTop: 6, background: "rgba(255,255,255,0.08)", color: "white", border: `1px solid ${C.gold}55`, borderRadius: 20, padding: "4px 12px", fontWeight: 700, fontSize: "0.68rem", cursor: "pointer", fontFamily: "inherit" }}
      >
        Close
      </button>
    </div>
  );
}
