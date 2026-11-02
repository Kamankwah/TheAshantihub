import { useMemo } from "react";
import { View } from "react-native";
import Svg, { Path, Rect } from "react-native-svg";

import { qrMatrix } from "./qr";

const QUIET = 2;

/**
 * A ticket's code as a QR drawn on the device (the code never goes to a QR service). Always dark on white, in dark
 * mode too: scanners need dark modules on a light quiet zone.
 */
export function TicketQr({ code, size = 200 }: { code: string; size?: number }) {
  const { size: n, dark } = useMemo(() => qrMatrix(code), [code]);
  const path = useMemo(() => {
    let d = "";
    for (let y = 0; y < n; y += 1) for (let x = 0; x < n; x += 1) if (dark[y * n + x]) d += `M${x + QUIET} ${y + QUIET}h1v1h-1z`;
    return d;
  }, [dark, n]);
  const box = n + QUIET * 2;
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={`QR code for ticket ${code}`} style={{ width: size, height: size, backgroundColor: "#FFFFFF", borderRadius: 8, overflow: "hidden" }}>
      <Svg width={size} height={size} viewBox={`0 0 ${box} ${box}`}>
        <Rect x={0} y={0} width={box} height={box} fill="#FFFFFF" />
        <Path d={path} fill="#000000" />
      </Svg>
    </View>
  );
}
