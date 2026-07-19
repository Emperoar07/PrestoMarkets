// The World Cup hub (header nav pill, home hero panel, /world-cup page) auto-retires once the
// tournament is over, so the app sheds that surface with no manual edit or redeploy. The gate is
// a plain time comparison evaluated at render, so it flips on its own the moment the window ends.
//
// Window end is NEXT_PUBLIC_WORLD_CUP_END (ISO). Default keeps the hub up through the day AFTER
// the 2026-07-19 final so the final fixture's market can close and resolve before the hub
// disappears. NEXT_PUBLIC_WORLD_CUP_ENDED=1 is an explicit kill switch that retires it immediately.
const DEFAULT_WC_END = '2026-07-20T23:59:59Z';

export function worldCupEndsAt(): number {
  const raw = (process.env.NEXT_PUBLIC_WORLD_CUP_END || DEFAULT_WC_END).trim();
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : Date.parse(DEFAULT_WC_END);
}

/** True while the World Cup hub should still be shown. Flips to false on its own at the window end. */
export function isWorldCupActive(now: number = Date.now()): boolean {
  if ((process.env.NEXT_PUBLIC_WORLD_CUP_ENDED || '').trim() === '1') return false;
  return now < worldCupEndsAt();
}
