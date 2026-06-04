import { getPublicMarket } from '@/lib/publicMarketSource';

export default async function EmbeddedMarketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const market = await getPublicMarket(id);

  if (!market) {
    return (
      <main className="min-h-screen bg-[#080d15] p-4 text-white">
        <section className="mx-auto max-w-[480px] rounded-[14px] border border-white/[0.08] bg-[#101929] p-5">
          <p className="text-sm font-black text-white">Market not found</p>
          <p className="mt-2 text-sm text-[#94a3b8]">This market is not available from Presto.</p>
        </section>
      </main>
    );
  }

  const primary = market.outcomes[0];
  const secondary = market.outcomes[1];

  return (
    <main className="min-h-screen bg-[#080d15] p-4 text-white">
      <article className="mx-auto max-w-[480px] overflow-hidden rounded-[14px] border border-white/[0.08] bg-[#101929]">
        {market.imageURI ? (
          <img src={market.imageURI} alt="" className="h-32 w-full object-cover" />
        ) : null}
        <div className="p-5">
          <div className="flex flex-wrap gap-2">
            <span className="rounded-full border border-cyan/30 bg-cyan/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-cyan">
              {market.type}
            </span>
            <span className="rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-[#94a3b8]">
              {market.status}
            </span>
          </div>
          <h1 className="mt-4 text-xl font-black leading-tight text-white">{market.title}</h1>
          <p className="mt-3 text-sm leading-6 text-[#94a3b8]">{market.closeLabel} · {market.volume} Vol.</p>
          <div className="mt-5 h-2 overflow-hidden rounded-full bg-white/[0.08]">
            <div className="h-full bg-cyan" style={{ width: `${primary?.odds ?? 50}%` }} />
          </div>
          <div className="mt-3 flex items-center justify-between gap-3 text-sm font-black">
            <span className="text-cyan">{primary?.label ?? 'YES'} {primary?.odds ?? 50}%</span>
            {secondary ? <span className="text-[#fb7185]">{secondary.label} {secondary.odds}%</span> : null}
          </div>
          <a
            href={`https://presto-markets.vercel.app/markets/${market.id}`}
            target="_blank"
            rel="noreferrer"
            className="mt-5 block rounded-[10px] bg-cyan px-4 py-3 text-center text-sm font-black text-[#07111f]"
          >
            Trade on Presto
          </a>
        </div>
      </article>
    </main>
  );
}
