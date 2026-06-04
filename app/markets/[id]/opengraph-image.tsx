import { ImageResponse } from 'next/og';
import { fetchOnchainMarkets } from '@/lib/onchainMarkets';

export const runtime = 'nodejs';
export const alt = 'Presto Markets — prediction market on Arc';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

// Dynamic Open Graph card so a shared /markets/<id> link unfurls as a branded card
// showing the question, category, primary odds, and status.
export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let title = 'Prediction market on Arc';
  let category = 'Presto Markets';
  let oddsLabel = '';
  let status = '';
  try {
    const markets = await fetchOnchainMarkets().catch(() => []);
    const market = markets.find((m) => m.id.toLowerCase() === id.toLowerCase());
    if (market) {
      title = market.title;
      category = market.category || 'Markets';
      status = market.status;
      const top = [...market.outcomes].sort((a, b) => Number(b.odds) - Number(a.odds))[0];
      if (top) oddsLabel = `${top.label} ${Math.round(Number(top.odds))}%`;
    }
  } catch {
    /* fall back to the generic card */
  }

  const clamped = title.length > 120 ? `${title.slice(0, 117)}…` : title;

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: 'linear-gradient(135deg, #090e1a 0%, #0d1520 100%)',
          padding: '64px 72px',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ width: 28, height: 28, borderRadius: 9999, background: '#25c0f4' }} />
          <div style={{ fontSize: 26, fontWeight: 800, color: '#f1f5f9', letterSpacing: -0.5 }}>Presto Markets</div>
          <div style={{ fontSize: 22, color: '#64748b' }}>· {category}</div>
        </div>

        <div style={{ display: 'flex', fontSize: 60, fontWeight: 800, color: '#ffffff', lineHeight: 1.1, letterSpacing: -1 }}>
          {clamped}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
            {oddsLabel ? (
              <div style={{ display: 'flex', fontSize: 40, fontWeight: 800, color: '#25c0f4' }}>{oddsLabel}</div>
            ) : null}
            {status ? (
              <div style={{ display: 'flex', fontSize: 24, color: '#94a3b8', border: '1px solid #1e293b', borderRadius: 9999, padding: '8px 20px' }}>
                {status}
              </div>
            ) : null}
          </div>
          <div style={{ display: 'flex', fontSize: 24, color: '#64748b' }}>USDC · Arc Testnet</div>
        </div>
      </div>
    ),
    size,
  );
}
