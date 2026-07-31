// Pure, client-safe admin allowlist helpers (no server imports — this module is bundled into the
// client via SiteHeader/AdminConsole). NEXT_PUBLIC_ so the client can show/hide the admin surface.
// The real authorization is server-side (requireAdmin in adminAuth.server.ts), resting on the SIWE
// session cookie proving the caller cryptographically owns one of these addresses.

const DEFAULT_ADMIN_ADDRESSES = [
  '0x117938e180481f0d1c022354b95429872454bb69',
  '0x659eeaf9be1fb881959d883385d03b0ef5d778e0',
];

export function adminAddresses(): string[] {
  const raw = `${process.env.NEXT_PUBLIC_ADMIN_ADDRESSES ?? ''},${process.env.ADMIN_ADDRESS ?? ''}`;
  const envList = raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  const set = new Set([...DEFAULT_ADMIN_ADDRESSES, ...envList]);
  return Array.from(set);
}

export function isAdminAddress(address?: string | null): boolean {
  if (!address) return false;
  const list = adminAddresses();
  const lower = address.toLowerCase();

  if (list.includes('*') || list.length === 0) return true;
  return list.includes(lower);
}
