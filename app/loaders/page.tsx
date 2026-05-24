export default function LoadersPreview() {
  return (
    <div className="min-h-screen bg-[#020617] p-16 text-white font-sans selection:bg-cyan-500/30">
      <div className="text-center mb-16">
        <h1 className="text-4xl font-black tracking-tight mb-2">Presto Loading States</h1>
        <p className="text-slate-400">Navigate to this page in your dev server to see the live CSS animations.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-8 max-w-[1400px] mx-auto">
        
        <style dangerouslySetInnerHTML={{__html: `
          .card-glass {
            background: rgba(15, 23, 42, 0.6);
            backdrop-filter: blur(16px);
            border: 1px solid rgba(30, 41, 59, 0.8);
            box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1), inset 0 1px 0 rgba(255,255,255,0.05);
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          }
          .card-glass:hover {
            transform: translateY(-6px);
            border-color: rgba(19, 181, 234, 0.3);
            box-shadow: 0 20px 25px -5px rgba(0,0,0,0.2), 0 0 20px rgba(19,181,234,0.4);
          }
          
          .logo-svg { width: 72px; height: 72px; filter: drop-shadow(0 0 12px rgba(19, 181, 234, 0.2)); }
          .ring-outer { stroke: #13b5ea; stroke-width: 4; fill: none; }
          .ring-inner { stroke: #ffffff; stroke-width: 4; fill: none; }
          .dot-center { fill: #13b5ea; }

          /* 1. Pulse */
          .loader-1 { animation: p-pulse 2.5s infinite cubic-bezier(0.4, 0, 0.2, 1); }
          @keyframes p-pulse {
            0% { transform: scale(0.95); opacity: 0.8; filter: drop-shadow(0 0 0px rgba(19,181,234,0.4)); }
            50% { transform: scale(1.05); opacity: 1; filter: drop-shadow(0 0 16px rgba(19,181,234,0.4)); }
            100% { transform: scale(0.95); opacity: 0.8; filter: drop-shadow(0 0 0px rgba(19,181,234,0.4)); }
          }

          /* 2. Radar */
          .loader-2 .dot-center { animation: p-radar 1.8s infinite ease-in-out; }
          .loader-2 .ring-inner { animation: p-radar 1.8s infinite ease-in-out 0.2s; }
          .loader-2 .ring-outer { animation: p-radar 1.8s infinite ease-in-out 0.4s; }
          @keyframes p-radar { 0%, 100% { opacity: 0.1; } 40%, 60% { opacity: 1; } }

          /* 3. Arcs */
          .loader-3 .ring-outer { stroke-dasharray: 120 40; transform-origin: center; animation: p-spin 2.5s cubic-bezier(0.68, -0.55, 0.265, 1.55) infinite; }
          .loader-3 .ring-inner { stroke-dasharray: 80 30; transform-origin: center; animation: p-spin-rev 2s cubic-bezier(0.68, -0.55, 0.265, 1.55) infinite; }
          @keyframes p-spin { 100% { transform: rotate(360deg); } }
          @keyframes p-spin-rev { 100% { transform: rotate(-360deg); } }

          /* 4. Ripple */
          .loader-4 .dot-center { animation: p-pop 2s infinite cubic-bezier(0.16, 1, 0.3, 1); }
          .loader-4 .ring-inner, .loader-4 .ring-outer { transform-origin: center; animation: p-ripple 2s infinite cubic-bezier(0.16, 1, 0.3, 1); }
          .loader-4 .ring-inner { animation-delay: 0.15s; }
          .loader-4 .ring-outer { animation-delay: 0.3s; }
          @keyframes p-pop { 0% { transform: scale(0.5); opacity: 0; } 30%, 100% { transform: scale(1); opacity: 1; } }
          @keyframes p-ripple { 0% { transform: scale(0.6); opacity: 0; stroke-width: 8; } 30% { transform: scale(1); opacity: 1; stroke-width: 4; } 100% { transform: scale(1.3); opacity: 0; stroke-width: 1; } }

          /* 5. Breathing */
          .loader-5 .ring-outer { transform-origin: center; animation: p-b-out 3s infinite cubic-bezier(0.4, 0, 0.2, 1); }
          .loader-5 .ring-inner { transform-origin: center; animation: p-b-in 3s infinite cubic-bezier(0.4, 0, 0.2, 1); }
          .loader-5 .dot-center { transform-origin: center; animation: p-b-dot 3s infinite cubic-bezier(0.4, 0, 0.2, 1); }
          @keyframes p-b-out { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.1); stroke-width: 3;} }
          @keyframes p-b-in { 0%, 100% { transform: scale(1); } 50% { transform: scale(0.85); stroke-width: 5;} }
          @keyframes p-b-dot { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.2); } }
        `}} />

        {/* 1. Pulse */}
        <div className="card-glass flex flex-col items-center justify-center p-12 rounded-3xl cursor-pointer group">
          <svg className="logo-svg loader-1" viewBox="0 0 64 64">
            <circle className="ring-outer" cx="32" cy="32" r="28" />
            <circle className="ring-inner" cx="32" cy="32" r="18" />
            <circle className="dot-center" cx="32" cy="32" r="8" />
          </svg>
          <div className="mt-8 text-sm font-bold text-slate-400 uppercase tracking-widest group-hover:text-[#13b5ea] transition-colors">1. Simple Pulse</div>
        </div>

        {/* 2. Radar */}
        <div className="card-glass flex flex-col items-center justify-center p-12 rounded-3xl cursor-pointer group">
          <svg className="logo-svg loader-2" viewBox="0 0 64 64">
            <circle className="ring-outer" cx="32" cy="32" r="28" />
            <circle className="ring-inner" cx="32" cy="32" r="18" />
            <circle className="dot-center" cx="32" cy="32" r="8" />
          </svg>
          <div className="mt-8 text-sm font-bold text-slate-400 uppercase tracking-widest group-hover:text-[#13b5ea] transition-colors">2. Radar Fade</div>
        </div>

        {/* 3. Arcs */}
        <div className="card-glass flex flex-col items-center justify-center p-12 rounded-3xl cursor-pointer group">
          <svg className="logo-svg loader-3" viewBox="0 0 64 64">
            <circle className="ring-outer" cx="32" cy="32" r="28" />
            <circle className="ring-inner" cx="32" cy="32" r="18" />
            <circle className="dot-center" cx="32" cy="32" r="8" />
          </svg>
          <div className="mt-8 text-sm font-bold text-slate-400 uppercase tracking-widest group-hover:text-[#13b5ea] transition-colors">3. Kinetic Arcs</div>
        </div>

        {/* 4. Ripple */}
        <div className="card-glass flex flex-col items-center justify-center p-12 rounded-3xl cursor-pointer group">
          <svg className="logo-svg loader-4" viewBox="0 0 64 64">
            <circle className="ring-outer" cx="32" cy="32" r="28" />
            <circle className="ring-inner" cx="32" cy="32" r="18" />
            <circle className="dot-center" cx="32" cy="32" r="8" />
          </svg>
          <div className="mt-8 text-sm font-bold text-slate-400 uppercase tracking-widest group-hover:text-[#13b5ea] transition-colors">4. Smooth Ripple</div>
        </div>

        {/* 5. Breathing */}
        <div className="card-glass flex flex-col items-center justify-center p-12 rounded-3xl cursor-pointer group">
          <svg className="logo-svg loader-5" viewBox="0 0 64 64">
            <circle className="ring-outer" cx="32" cy="32" r="28" />
            <circle className="ring-inner" cx="32" cy="32" r="18" />
            <circle className="dot-center" cx="32" cy="32" r="8" />
          </svg>
          <div className="mt-8 text-sm font-bold text-slate-400 uppercase tracking-widest group-hover:text-[#13b5ea] transition-colors">5. Fluid Breathe</div>
        </div>

      </div>
    </div>
  );
}
