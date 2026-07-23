import { AdminConsole } from '@/components/AdminConsole';

// Admin-only agent control console. The route is publicly reachable but shows nothing actionable
// unless the connected wallet is an allowlisted admin AND signed in (SIWE) — every action goes
// through /api/admin/agent, which re-checks the session server-side before any agent key acts.
export const dynamic = 'force-dynamic';

export default function AdminPage() {
  return <AdminConsole />;
}
