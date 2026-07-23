// Pure, client-safe admin allowlist helpers (no server imports — this module is bundled into the
// client via SiteHeader/AdminConsole). NEXT_PUBLIC_ so the client can show/hide the admin surface,
// but that is UX only: the real authorization is server-side (requireAdmin in adminAuth.server.ts),
// resting on the SIWE session cookie proving the caller cryptographically owns one of these
// addresses. The address list itself is not a secret.
export function adminAddresses(): string[] {
  return (process.env.NEXT_PUBLIC_ADMIN_ADDRESSES ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.startsWith('0x') && s.length === 42);
}

export function isAdminAddress(address?: string | null): boolean {
  if (!address) return false;
  return adminAddresses().includes(address.toLowerCase());
}
