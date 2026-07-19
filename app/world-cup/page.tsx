import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { WorldCupClient } from '@/components/WorldCupClient';
import { isWorldCupActive } from '@/lib/worldCup';

export const metadata: Metadata = {
  title: 'World Cup — Presto Markets',
  description: 'Live FIFA World Cup 2026 predictions and odds. Every fixture gets its own agent-created USDC market on Arc.',
};

// Re-evaluate on every request so the hub retires itself at the tournament window end without a
// redeploy. Once inactive the heavy WorldCupClient never renders — the route just bounces to
// the markets grid, shedding that bundle from the retired app.
export const dynamic = 'force-dynamic';

export default function WorldCupPage() {
  if (!isWorldCupActive()) redirect('/markets');
  return <WorldCupClient />;
}
