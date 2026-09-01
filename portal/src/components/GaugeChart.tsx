"use client";

// Simple semicircle gauge, 0-3 scale, banded Compliance/Maturing/Cultural
// (matching the UK SRS Readiness scoring bands: 1.0-1.4 / 1.5-2.3 / 2.4-3.0).
// No chart library dependency -- just an SVG arc.

const MIN = 0;
const MAX = 3;
const BANDS: { from: number; to: number; color: string }[] = [
  { from: 0, to: 1.5, color: "#cbd5e1" },   // Compliance -- slate
  { from: 1.5, to: 2.4, color: "#fbbf24" }, // Maturing -- amber
  { from: 2.4, to: 3, color: "#22c55e" },   // Cultural -- green
];

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const angleRad = ((angleDeg - 180) * Math.PI) / 180;
  return { x: cx + r * Math.cos(angleRad), y: cy + r * Math.sin(angleRad) };
}

function arcPath(cx: number, cy: number, r: number, startAngle: number, endAngle: number) {
  const start = polarToCartesian(cx, cy, r, startAngle);
  const end = polarToCartesian(cx, cy, r, endAngle);
  const largeArc = endAngle - startAngle <= 180 ? 0 : 1;
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y}`;
}

function valueToAngle(value: number) {
  const clamped = Math.max(MIN, Math.min(MAX, value));
  return (clamped / MAX) * 180;
}

export default function GaugeChart({
  value,
  label,
  maturityLabel,
  maturityDescription,
  deltaLabel,
}: {
  value: number | null;
  label: string;
  maturityLabel?: string | null;
  maturityDescription?: string | null;
  deltaLabel?: string | null;
}) {
  const size = 180;
  const cx = size / 2;
  const cy = size / 2 + 10;
  const r = 70;
  const needleAngle = value !== null ? valueToAngle(value) : 0;
  const needleTip = polarToCartesian(cx, cy, r - 12, needleAngle);

  return (
    <div className="flex flex-col items-center gap-1">
      <svg width={size} height={size / 2 + 30} viewBox={`0 0 ${size} ${size / 2 + 30}`}>
        {BANDS.map((band) => (
          <path
            key={band.from}
            d={arcPath(cx, cy, r, valueToAngle(band.from), valueToAngle(band.to))}
            stroke={band.color}
            strokeWidth={16}
            fill="none"
            strokeLinecap="butt"
          />
        ))}
        {value !== null && (
          <>
            <line x1={cx} y1={cy} x2={needleTip.x} y2={needleTip.y} stroke="#1c5026" strokeWidth={3} strokeLinecap="round" />
            <circle cx={cx} cy={cy} r={5} fill="#1c5026" />
          </>
        )}
        <text x={cx} y={cy - 18} textAnchor="middle" className="fill-gray-900" style={{ fontSize: 20, fontWeight: 700 }}>
          {value !== null ? value.toFixed(1) : "—"}
        </text>
      </svg>
      <div className="text-center">
        <div className="text-sm font-semibold text-gray-800">{label}</div>
        {maturityLabel ? (
          <div className="text-xs text-gray-500">{maturityLabel} &middot; {maturityDescription}</div>
        ) : (
          <div className="text-xs text-gray-400">Not scored yet</div>
        )}
        {deltaLabel && <div className="mt-0.5 text-xs font-medium text-gray-600">{deltaLabel}</div>}
      </div>
    </div>
  );
}
