import type { Metadata } from 'next';
import { WorldCupClient } from '@/components/WorldCupClient';

export const metadata: Metadata = {
  title: 'World Cup — Presto Markets',
  description: 'Live FIFA World Cup 2026 predictions and odds. Every fixture gets its own agent-created USDC market on Arc.',
};

export default function WorldCupPage() {
  return <WorldCupClient />;
}
