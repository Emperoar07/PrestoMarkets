/** Half-circle chance gauge — used only on pulse/directional market cards. */
export function ChanceMeter({ percent }: { percent: number }) {
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));
  const dash = `${(clamped / 100) * 112} 120`;
  const color = clamped >= 50 ? '#34d399' : '#ff555e';

  return (
    <div className="relative h-[52px] w-16 shrink-0" aria-label={`Best chance ${clamped}%`}>
      <svg className="absolute inset-0 h-[42px] w-16" viewBox="0 0 100 64" aria-hidden="true">
        <path d="M12 54 A38 38 0 0 1 88 54" className="fill-none stroke-[#475569]/75 stroke-[6] [stroke-linecap:round]" />
        <path d="M12 54 A38 38 0 0 1 88 54" style={{ strokeDasharray: dash, stroke: color }} className="fill-none stroke-[6] [stroke-linecap:round]" />
      </svg>
      <div className="absolute left-0 right-0 top-[21px] text-center">
        <strong className="block text-[8.5px] font-black leading-none text-white">{clamped}%</strong>
        <span className="mt-[3px] block text-[9px] font-extrabold leading-none text-[#94a3b8]">chance</span>
      </div>
    </div>
  );
}
