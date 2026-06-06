import { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CATEGORY_COLORS: Record<string, { accent: string; secondary: string }> = {
  crypto: { accent: '#25c0f4', secondary: '#facc15' },
  btc: { accent: '#f59e0b', secondary: '#25c0f4' },
  eth: { accent: '#8b5cf6', secondary: '#25c0f4' },
  sports: { accent: '#35f5a2', secondary: '#25c0f4' },
  football: { accent: '#35f5a2', secondary: '#94a3b8' },
  basketball: { accent: '#fb923c', secondary: '#25c0f4' },
  politics: { accent: '#60a5fa', secondary: '#f87171' },
  finance: { accent: '#35f5a2', secondary: '#25c0f4' },
  tech: { accent: '#25c0f4', secondary: '#a78bfa' },
  ai: { accent: '#25c0f4', secondary: '#35f5a2' },
  weather: { accent: '#38bdf8', secondary: '#facc15' },
};

function escapeXml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function cleanText(value: string | null, fallback: string, max = 90) {
  const cleaned = (value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
  return cleaned || fallback;
}

function initials(value: string) {
  const words = value
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 2)
    .slice(0, 2);
  return (words.map((word) => word[0]).join('') || 'PM').toUpperCase();
}

function wrapTitle(title: string) {
  const words = title.split(/\s+/);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > 34 && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
    if (lines.length >= 3) break;
  }

  if (current && lines.length < 3) lines.push(current);
  return lines;
}

export async function GET(request: NextRequest) {
  const title = cleanText(request.nextUrl.searchParams.get('title'), 'Presto market', 120);
  const category = cleanText(request.nextUrl.searchParams.get('category'), 'Market', 32);
  const source = cleanText(request.nextUrl.searchParams.get('source'), 'Agent', 32);
  const palette = CATEGORY_COLORS[category.toLowerCase()] ?? { accent: '#25c0f4', secondary: '#35f5a2' };
  const titleLines = wrapTitle(title).map(escapeXml);
  const safeCategory = escapeXml(category);
  const safeSource = escapeXml(source);
  const safeInitials = escapeXml(initials(title));
  const categoryPillWidth = Math.max(118, safeCategory.length * 14 + 48);
  const sourceX = Math.max(154, safeCategory.length * 14 + 76);

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img" aria-label="${escapeXml(title)}">
  <defs>
    <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0" stop-color="#101929"/>
      <stop offset="1" stop-color="#080d17"/>
    </linearGradient>
    <radialGradient id="soft" cx="72%" cy="30%" r="52%">
      <stop offset="0" stop-color="${palette.accent}" stop-opacity="0.22"/>
      <stop offset="1" stop-color="${palette.accent}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <rect width="1200" height="630" fill="url(#soft)"/>
  <path d="M0 472 C230 410 380 514 600 454 S950 350 1200 420 L1200 630 L0 630 Z" fill="${palette.accent}" opacity="0.08"/>
  <path d="M770 78 H1034 Q1080 78 1080 124 V378" fill="none" stroke="${palette.accent}" stroke-width="3" opacity="0.23"/>
  <circle cx="978" cy="196" r="138" fill="none" stroke="${palette.secondary}" stroke-width="18" opacity="0.14"/>
  <circle cx="978" cy="196" r="84" fill="none" stroke="${palette.accent}" stroke-width="14" opacity="0.22"/>
  <circle cx="978" cy="196" r="32" fill="${palette.accent}" opacity="0.9"/>
  <rect x="74" y="70" width="138" height="138" rx="28" fill="#0b1422" stroke="rgba(255,255,255,0.10)" stroke-width="2"/>
  <text x="143" y="151" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="44" font-weight="900" fill="${palette.accent}">${safeInitials}</text>
  <text x="74" y="276" font-family="Inter, Arial, sans-serif" font-size="24" font-weight="900" letter-spacing="7" fill="${palette.accent}">PRESTO MARKET</text>
  ${titleLines.map((line, index) => `<text x="74" y="${348 + index * 58}" font-family="Inter, Arial, sans-serif" font-size="46" font-weight="900" fill="#f8fafc">${line}</text>`).join('')}
  <g transform="translate(74 536)">
    <rect width="${categoryPillWidth}" height="48" rx="24" fill="${palette.accent}" opacity="0.16" stroke="${palette.accent}" stroke-width="2"/>
    <text x="24" y="31" font-family="Inter, Arial, sans-serif" font-size="18" font-weight="900" letter-spacing="3" fill="${palette.accent}">${safeCategory.toUpperCase()}</text>
    <text x="${sourceX}" y="31" font-family="Inter, Arial, sans-serif" font-size="18" font-weight="800" fill="#94a3b8">${safeSource}</text>
  </g>
</svg>`;

  return new Response(svg, {
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}
