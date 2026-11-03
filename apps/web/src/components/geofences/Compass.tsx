// Needle shows the real GPS heading (degrees) of the selected vehicle. With
// nothing selected there is no bearing to show, so the needle is omitted
// rather than pointing at a fabricated direction.
export default function Compass({ heading, label }: { heading: number | null; label: string }) {
  return (
    <div className="absolute bottom-3 left-3 bg-black/70 backdrop-blur border border-gray-700 rounded-full w-16 h-16 flex items-center justify-center">
      <svg width={44} height={44} viewBox="0 0 44 44">
        <circle cx={22} cy={22} r={19} fill="none" stroke="rgba(148,163,184,.35)" strokeWidth={1} />
        <text x={22} y={8} textAnchor="middle" fill="rgba(148,163,184,.7)" fontSize={6} fontWeight={700}>N</text>
        <text x={22} y={41} textAnchor="middle" fill="rgba(148,163,184,.5)" fontSize={6} fontWeight={700}>S</text>
        <text x={40} y={24} textAnchor="middle" fill="rgba(148,163,184,.5)" fontSize={6} fontWeight={700}>E</text>
        <text x={4} y={24} textAnchor="middle" fill="rgba(148,163,184,.5)" fontSize={6} fontWeight={700}>W</text>
        {heading != null && (
          <g transform={`rotate(${heading} 22 22)`}>
            <polygon points="22,7 26,22 22,19 18,22" fill="#22d3ee" />
            <polygon points="22,37 26,22 22,25 18,22" fill="#475569" />
          </g>
        )}
        <circle cx={22} cy={22} r={2} fill={heading != null ? '#22d3ee' : '#475569'} />
      </svg>
      <span className="absolute -bottom-5 left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] font-semibold text-gray-400">{label}</span>
    </div>
  );
}
