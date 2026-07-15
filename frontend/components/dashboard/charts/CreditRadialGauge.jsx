import { RadialBarChart, RadialBar, PolarAngleAxis, ResponsiveContainer } from "recharts";
import { D, getScoreColor, getScoreGrade } from "../theme.js";
import { ChartEmpty } from "./ChartFrame.jsx";

// Credit-score gauge (0–1000) rendered as a 270° radial bar with the score +
// grade in the centre. `score` is the real value from GET /api/credit/scores/me/.
// Replaces the hand-rolled half-circle SVG ScoreGauge look for the analytics hub.
export default function CreditRadialGauge({ score, size = 200 }) {
  if (score == null) return <ChartEmpty>No credit score yet.</ChartEmpty>;
  const color = getScoreColor(score);
  const { grade, label } = getScoreGrade(score);
  const data = [{ name: "score", value: score, fill: color }];
  return (
    <div style={{ position: "relative", width: "100%", height: size }}>
      <ResponsiveContainer width="100%" height="100%">
        <RadialBarChart innerRadius="72%" outerRadius="100%" data={data} startAngle={225} endAngle={-45} barSize={14}>
          <PolarAngleAxis type="number" domain={[300, 1000]} tick={false} />
          <RadialBar background={{ fill: "rgba(148,164,191,0.16)" }} dataKey="value" cornerRadius={10} />
        </RadialBarChart>
      </ResponsiveContainer>
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
        <div style={{ fontWeight: 900, fontSize: "2rem", color, lineHeight: 1 }}>{score}</div>
        <div style={{ fontSize: "0.58rem", color: D.textDim, textTransform: "uppercase", letterSpacing: "0.06em" }}>out of 1000</div>
        <div style={{ marginTop: 6, background: `${color}22`, color, borderRadius: 20, padding: "2px 11px", fontSize: "0.68rem", fontWeight: 900 }}>{grade} — {label}</div>
      </div>
    </div>
  );
}
